"""文档管理接口：上传 / 列表 / 原文件预览 / 删除 / 进度(SSE)。"""

import json
import time
import uuid

from flask import Blueprint, Response, abort, jsonify, request, send_file

from config import config

from .. import db
from ..services.ingest import start_processing
from ..services.parsing import is_supported
from ..vectorstore import get_vector_store

documents_bp = Blueprint("documents", __name__, url_prefix="/api/documents")


def _dto(d: dict) -> dict:
    """SQLite 行 → 前端用的结构（createdAt 用毫秒）。"""
    return {
        "id": d["id"],
        "name": d["name"],
        "ext": d["ext"],
        "size": d["size"],
        "status": d["status"],
        "chunks": d["chunks"],
        "error": d["error"],
        "createdAt": d["created_at"] * 1000,
    }


@documents_bp.post("")
def upload():
    file = request.files.get("file")
    if not file or not file.filename:
        abort(400, description="缺少文件")
    name = file.filename
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if not is_supported(ext):
        abort(400, description=f"暂不支持的格式: .{ext}")

    doc_id = uuid.uuid4().hex
    config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)  # 兜底：目录被删也能自愈
    save_path = config.UPLOAD_DIR / f"{doc_id}.{ext}"
    file.save(str(save_path))
    size = save_path.stat().st_size

    doc = db.create_document(doc_id, name, ext, size)
    start_processing(doc_id, save_path, ext, name)  # 后台异步处理
    return jsonify(_dto(doc)), 201


@documents_bp.get("")
def list_docs():
    return jsonify([_dto(d) for d in db.list_documents()])


@documents_bp.get("/<doc_id>/file")
def get_file(doc_id: str):
    d = db.get_document(doc_id)
    if not d:
        abort(404)
    path = config.UPLOAD_DIR / f"{doc_id}.{d['ext']}"
    if not path.exists():
        abort(404)
    return send_file(str(path), download_name=d["name"])


@documents_bp.delete("/<doc_id>")
def delete_doc(doc_id: str):
    d = db.get_document(doc_id)
    if not d:
        abort(404)
    get_vector_store().remove(db.get_chunk_ids(doc_id))  # 删向量
    db.delete_document(doc_id)  # 删记录（级联删分块）
    path = config.UPLOAD_DIR / f"{doc_id}.{d['ext']}"
    if path.exists():
        path.unlink()  # 删原文件
    return "", 204


@documents_bp.get("/<doc_id>/progress")
def progress(doc_id: str):
    """SSE：轮询 DB，把该文档的状态流转实时推给前端，到 done/failed 结束。"""

    def gen():
        last = None
        while True:
            d = db.get_document(doc_id)
            if not d:
                yield f"data: {json.dumps({'status': 'deleted'})}\n\n"
                return
            if d["status"] != last:
                last = d["status"]
                payload = {
                    "status": d["status"],
                    "chunks": d["chunks"],
                    "error": d["error"],
                }
                yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
            if d["status"] in ("done", "failed"):
                return
            time.sleep(0.5)

    return Response(
        gen(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
