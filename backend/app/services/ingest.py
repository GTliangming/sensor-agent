"""导入流水线：解析 → 分块 → 向量化 → 入库，并逐阶段更新状态。

状态流转（与前端一致）：pending → parsing → chunking → embedding → storing → done / failed
由上传接口在后台线程里调用，不阻塞请求。
"""

import threading
import traceback
from pathlib import Path

from langchain_text_splitters import RecursiveCharacterTextSplitter

from config import config

from .. import db
from ..clients.embedding import embed_texts
from ..vectorstore import get_vector_store
from .parsing import ATOMIC_EXTS, parse_units

_splitter = RecursiveCharacterTextSplitter(
    chunk_size=config.CHUNK_SIZE,
    chunk_overlap=config.CHUNK_OVERLAP,
)


def _to_chunks(units: list[str], ext: str) -> list[str]:
    """把解析单元转成最终分块。

    - 表格类（如 xlsx）的每行记录是「原子单元」，保持完整不切，确保按型号精确检索；
    - 普通正文单元按长度用递归分割器切块。
    """
    chunks: list[str] = []
    for u in units:
        u = (u or "").strip()
        if not u:
            continue
        if ext in ATOMIC_EXTS:
            chunks.append(u)
        else:
            chunks.extend(_splitter.split_text(u))
    return chunks


def _fail(doc_id: str, file_path, error: str) -> None:
    """置为失败，并删除没用的原始文件（解析不了，留着只占磁盘）。"""
    db.update_status(doc_id, "failed", error=error)
    try:
        p = Path(file_path)
        if p.exists():
            p.unlink()
    except Exception:
        pass


def process_document(doc_id: str, file_path, ext: str, name: str) -> None:
    """同步跑完整条流水线（供后台线程调用）。每一步更新 SQLite 状态。"""
    try:
        db.update_status(doc_id, "parsing")
        units = parse_units(file_path, ext)
        if not any(u.strip() for u in units):
            _fail(doc_id, file_path, "未提取到文本（可能是扫描型 PDF，需 OCR）")
            return

        db.update_status(doc_id, "chunking")
        chunks = _to_chunks(units, ext.lower().lstrip("."))
        if not chunks:
            _fail(doc_id, file_path, "分块结果为空")
            return

        db.update_status(doc_id, "embedding")
        vectors = embed_texts(chunks)

        db.update_status(doc_id, "storing")
        items = [(i, c, f"{name}#{i}") for i, c in enumerate(chunks)]
        chunk_ids = db.add_chunks(doc_id, items)
        get_vector_store().add(chunk_ids, vectors)

        db.update_status(doc_id, "done", chunks=len(chunk_ids))
    except Exception as e:  # 任一步失败都置 failed，不影响其它文档
        traceback.print_exc()
        _fail(doc_id, file_path, str(e))


def start_processing(doc_id: str, file_path, ext: str, name: str) -> None:
    """开后台线程跑流水线，立即返回。"""
    threading.Thread(
        target=process_document,
        args=(doc_id, file_path, ext, name),
        daemon=True,
    ).start()
