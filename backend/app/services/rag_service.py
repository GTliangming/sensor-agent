"""问答链路（RAG）：检索 → 拼 Prompt → 调 DeepSeek 流式作答，带出处。

SSE 协议：每个正常片段是 JSON 编码的文本、以 data: 行发送；出错时发
data: [ERROR] <说明>；最后统一 data: [DONE]。出处由模型按 Prompt 写在答案末尾。
"""

import json
import re
import traceback
from typing import Iterator

from config import config

from .. import db
from ..clients.embedding import embed_query
from ..clients.llm import get_llm_client
from ..vectorstore import get_vector_store

SYSTEM_PROMPT = """你是工业传感器与示波器领域的技术助手。请**只依据**下面提供的【资料】回答用户问题。
要求：
1. 答案必须来自资料；资料中没有的，直接说“根据现有资料无法回答”，不要编造。
2. 涉及参数、数值、型号时，与资料严格保持一致，不要臆测。
3. 用中文回答，可用 Markdown（表格、公式等）让表述更清晰。
4. 在答案末尾用【出处】简要标注依据了哪些文档（按文件名列出即可，不要逐条罗列每个表格行）。
5. 用户查询一类产品的报价、汇总或列表时，逐条核对资料中的类别、方式和价格，列出所有符合问题的记录，不要漏掉不同类别，也不要把相同价格视为重复记录。"""


def _build_context(chunks: list[dict]) -> str:
    return "\n\n".join(f"[{c['source']}]\n{c['text']}" for c in chunks)


class RetrievalError(Exception):
    """向量化 / 检索阶段的故障（区别于“文档里没有相关内容”）。"""


def _retrieve(question: str) -> list[dict]:
    """向量检索 → 回表 → 补齐小型工作表。

    服务故障（embedding / FAISS 异常）抛 RetrievalError，由上层透出给用户；
    “检索成功但没命中”返回空列表，是正常的“无资料”语义。
    """
    try:
        qvec = embed_query(question)
        hits = get_vector_store().search(qvec, config.TOP_K)
    except Exception as exc:  # noqa: BLE001 —— 统一转成领域异常再透出
        raise RetrievalError("检索服务暂时不可用，请稍后重试") from exc
    chunks = db.get_chunks_by_ids([cid for cid, _ in hits])
    return _expand_small_sheets(chunks)


def _expand_small_sheets(chunks: list[dict]) -> list[dict]:
    """向量命中行作为入口，补齐同一文档的小型工作表并按原行序排列。"""
    expanded = []
    seen_ids = set()
    checked_sheets = set()
    for chunk in chunks:
        records = [chunk]
        match = re.match(r"^\[[^\]\n]+\] ", chunk["text"])
        if match:
            prefix = match.group(0)
            key = (chunk["doc_id"], prefix)
            if key not in checked_sheets:
                checked_sheets.add(key)
                records = db.get_small_sheet_chunks(*key) or records
        for record in records:
            if record["id"] not in seen_ids:
                seen_ids.add(record["id"])
                expanded.append(record)
    return expanded


def _sse(payload: str) -> str:
    return f"data: {payload}\n\n"


def _sse_error(message: str) -> str:
    """错误事件：用 [ERROR] 前缀与正常片段区分（正常片段是 JSON 字符串，必以引号开头）。"""
    return _sse(f"[ERROR] {message}")


def _sse_sources(chunks: list[dict]) -> str:
    """出处事件：按文档去重（而非逐块）。

    XLSX 命中会把整张工作表补进上下文，逐块列出会有几十条噪音；
    引用的意义是“答案依据了哪些文档”，所以折叠到文件名（去掉 #序号）。
    """
    seen: list[str] = []
    for c in chunks:
        src = c.get("source") or ""
        name = src.rsplit("#", 1)[0] if "#" in src else src
        if name and name not in seen:
            seen.append(name)
    return _sse(f"[SOURCES] {json.dumps(seen, ensure_ascii=False)}")


def stream_answer(question: str) -> Iterator[str]:
    try:
        chunks = _retrieve(question)
    except RetrievalError as exc:
        yield _sse_error(str(exc))
        yield _sse("[DONE]")
        return

    if chunks:
        yield _sse_sources(chunks)

    context = _build_context(chunks) if chunks else "（无相关资料）"
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"【资料】\n{context}\n\n【问题】\n{question}"},
    ]

    try:
        client = get_llm_client()
        stream = client.chat.completions.create(
            model=config.DEEPSEEK_MODEL, messages=messages, stream=True
        )
        for chunk in stream:
            delta = chunk.choices[0].delta.content or ""
            if delta:
                yield _sse(json.dumps(delta, ensure_ascii=False))
    except Exception:  # noqa: BLE001 —— 流已开始，异常只能通过错误事件透出
        traceback.print_exc()
        yield _sse_error("生成回答时出错，请稍后重试")
    finally:
        yield _sse("[DONE]")
