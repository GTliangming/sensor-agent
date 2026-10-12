"""问答链路（RAG）：检索 → 拼 Prompt → 调 DeepSeek 流式作答，带出处。

SSE 协议与之前一致：每个片段是 JSON 编码的文本、以 data: 行发送，最后 data: [DONE]。
所以前端 chat.ts 不用改。出处由模型按 Prompt 要求写在答案末尾的【出处】里。
"""

import json
import re
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
4. 在答案末尾用【出处】列出你引用了哪些资料片段（格式：文件名#序号）。
5. 用户查询一类产品的报价、汇总或列表时，逐条核对资料中的类别、方式和价格，列出所有符合问题的记录，不要漏掉不同类别，也不要把相同价格视为重复记录。"""


def _build_context(chunks: list[dict]) -> str:
    return "\n\n".join(f"[{c['source']}]\n{c['text']}" for c in chunks)


def _retrieve(question: str) -> list[dict]:
    """向量检索 → 回表 → 补齐小型工作表；向量调用异常退化为“无资料”。"""
    try:
        qvec = embed_query(question)
        hits = get_vector_store().search(qvec, config.TOP_K)
    except Exception:
        return []
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


def stream_answer(question: str) -> Iterator[str]:
    chunks = _retrieve(question)
    context = _build_context(chunks) if chunks else "（无相关资料）"
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"【资料】\n{context}\n\n【问题】\n{question}"},
    ]

    client = get_llm_client()
    stream = client.chat.completions.create(
        model=config.DEEPSEEK_MODEL, messages=messages, stream=True
    )
    for chunk in stream:
        delta = chunk.choices[0].delta.content or ""
        if delta:
            yield f"data: {json.dumps(delta, ensure_ascii=False)}\n\n"
    yield "data: [DONE]\n\n"
