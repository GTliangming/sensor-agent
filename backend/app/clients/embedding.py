"""外部依赖层：SiliconFlow 的 embedding 客户端（bge-m3）。

DeepSeek 没有 embedding 接口，向量化走 SiliconFlow（OpenAI 兼容）。
"""

from functools import lru_cache

from openai import OpenAI

from config import config


@lru_cache(maxsize=1)
def get_embedding_client() -> OpenAI:
    """SiliconFlow 走 OpenAI 兼容接口；客户端进程内只建一次、复用。"""
    config.validate_embedding()
    return OpenAI(
        api_key=config.SILICONFLOW_API_KEY,
        base_url=config.SILICONFLOW_BASE_URL,
    )


def embed_texts(texts: list[str], batch_size: int = 32) -> list[list[float]]:
    """把一批文本向量化，返回每条文本的向量（维度 = EMBEDDING_DIM）。

    分批请求，避免一次塞太多超过接口上限。
    """
    client = get_embedding_client()
    out: list[list[float]] = []
    for i in range(0, len(texts), batch_size):
        resp = client.embeddings.create(
            model=config.EMBEDDING_MODEL, input=texts[i : i + batch_size]
        )
        out.extend(item.embedding for item in resp.data)
    return out


def embed_query(text: str) -> list[float]:
    """单条文本向量化（问答检索时用）。"""
    return embed_texts([text])[0]
