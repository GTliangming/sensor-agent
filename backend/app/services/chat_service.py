"""业务逻辑层。路由只调用这里，不直接碰外部客户端。"""

import json
from typing import Iterator

from config import config
from ..clients.llm import get_llm_client


def stream_answer(question: str) -> Iterator[str]:
    """阶段 0：直接把问题丢给 DeepSeek，逐字流式返回（SSE 格式）。

    阶段 1 接入 RAG 后，改成：
        1) 用 bge-m3 把 question 向量化
        2) 在 Milvus 检索 top-k 片段
        3) 把片段拼进 system/messages，再调用 LLM
        4) 结尾附上【出处】
    改动集中在这个函数，路由层不用动。
    """
    client = get_llm_client()
    stream = client.chat.completions.create(
        model=config.DEEPSEEK_MODEL,
        messages=[{"role": "user", "content": question}],
        stream=True,
    )
    for chunk in stream:
        delta = chunk.choices[0].delta.content or ""
        if delta:
            # JSON 编码：把片段里的换行等转义，避免和 SSE 的 \n\n 帧分隔符冲突
            yield f"data: {json.dumps(delta, ensure_ascii=False)}\n\n"
    yield "data: [DONE]\n\n"
