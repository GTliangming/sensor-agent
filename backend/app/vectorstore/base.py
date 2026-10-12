"""向量库抽象接口。

业务层只依赖这个接口，不直接依赖 FAISS。
将来换 Milvus 时，新增一个 MilvusStore(VectorStore) 即可，业务代码不动。
"""

from abc import ABC, abstractmethod


class VectorStore(ABC):
    @abstractmethod
    def add(self, ids: list[int], vectors: list[list[float]]) -> None:
        """按 id 批量加入向量（id = SQLite chunks.id）。"""

    @abstractmethod
    def search(self, vector: list[float], top_k: int) -> list[tuple[int, float]]:
        """检索最相似的 top_k，返回 [(chunk_id, score)]，按相关性降序。"""

    @abstractmethod
    def remove(self, ids: list[int]) -> None:
        """按 id 批量删除向量（删除文档时用）。"""

    @abstractmethod
    def save(self) -> None:
        """持久化到磁盘。"""
