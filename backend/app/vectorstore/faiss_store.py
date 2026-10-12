"""FAISS 向量库实现（轻量、本地、无需 Docker）。

- 用 IndexIDMap2(IndexFlatIP)：内积 + 向量归一化 = 余弦相似度；IDMap 让向量绑定 chunk_id、支持按 id 删除。
- 加锁保证线程安全（后台处理线程会写，问答线程会读）。
- 每次增/删后落盘，避免进程重启丢索引。
"""

import threading

import faiss
import numpy as np

from config import config

from .base import VectorStore


class FaissStore(VectorStore):
    def __init__(self, dim: int, path) -> None:
        self.dim = dim
        self.path = path
        self._lock = threading.Lock()
        if path.exists():
            self.index = faiss.read_index(str(path))
        else:
            self.index = faiss.IndexIDMap2(faiss.IndexFlatIP(dim))

    def add(self, ids: list[int], vectors: list[list[float]]) -> None:
        if not ids:
            return
        vecs = np.asarray(vectors, dtype="float32")
        faiss.normalize_L2(vecs)  # 归一化 → 内积即余弦
        id_arr = np.asarray(ids, dtype="int64")
        with self._lock:
            self.index.add_with_ids(vecs, id_arr)
            self._save_unlocked()

    def search(self, vector: list[float], top_k: int) -> list[tuple[int, float]]:
        q = np.asarray([vector], dtype="float32")
        faiss.normalize_L2(q)
        with self._lock:
            if self.index.ntotal == 0:
                return []
            scores, ids = self.index.search(q, min(top_k, self.index.ntotal))
        return [
            (int(i), float(s)) for i, s in zip(ids[0], scores[0]) if i != -1
        ]

    def remove(self, ids: list[int]) -> None:
        if not ids:
            return
        id_arr = np.asarray(ids, dtype="int64")
        with self._lock:
            self.index.remove_ids(id_arr)
            self._save_unlocked()

    def save(self) -> None:
        with self._lock:
            self._save_unlocked()

    def _save_unlocked(self) -> None:
        config.DATA_DIR.mkdir(parents=True, exist_ok=True)
        faiss.write_index(self.index, str(self.path))
