"""向量库入口：对外只暴露 get_vector_store()。

这里是“将来换 Milvus”的唯一切换点：改成按 config 开关返回 FaissStore / MilvusStore 即可，
业务层拿到的都是 VectorStore 接口，不用改。
"""

from functools import lru_cache

from config import config

from .base import VectorStore
from .faiss_store import FaissStore


@lru_cache(maxsize=1)
def get_vector_store() -> VectorStore:
    return FaissStore(config.EMBEDDING_DIM, config.FAISS_INDEX_PATH)
