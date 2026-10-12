"""SQLite 持久化层：文档元数据 + 分块文本 + 处理状态。

- documents 表：一篇文档一行（含四阶段状态）
- chunks 表：一篇文档的若干分块，chunks.id（自增整数）同时用作 FAISS 的向量 id
用“每次操作开一个连接”的方式，天然线程安全（后台处理线程也能用）。
"""

import sqlite3
import time
from contextlib import contextmanager
from typing import Iterable, Optional

from config import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    ext        TEXT,
    size       INTEGER,
    status     TEXT NOT NULL DEFAULT 'pending',
    chunks     INTEGER NOT NULL DEFAULT 0,
    error      TEXT,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id      TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    text        TEXT NOT NULL,
    source      TEXT,
    FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id);
"""


def init_db() -> None:
    """建目录 + 建表（幂等，启动时调用）。"""
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    with get_conn() as conn:
        conn.executescript(SCHEMA)


@contextmanager
def get_conn():
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")  # 让 chunks 跟随 document 级联删除
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


# PLACEHOLDER_CRUD

# ===== documents =====

def create_document(doc_id: str, name: str, ext: str, size: int) -> dict:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO documents (id, name, ext, size, status, created_at) "
            "VALUES (?, ?, ?, ?, 'pending', ?)",
            (doc_id, name, ext, size, int(time.time())),
        )
    return get_document(doc_id)


def update_status(
    doc_id: str,
    status: str,
    error: Optional[str] = None,
    chunks: Optional[int] = None,
) -> None:
    sets = ["status = ?"]
    vals: list = [status]
    if error is not None:
        sets.append("error = ?")
        vals.append(error)
    if chunks is not None:
        sets.append("chunks = ?")
        vals.append(chunks)
    vals.append(doc_id)
    with get_conn() as conn:
        conn.execute(f"UPDATE documents SET {', '.join(sets)} WHERE id = ?", vals)


def list_documents() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM documents ORDER BY created_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def get_document(doc_id: str) -> Optional[dict]:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM documents WHERE id = ?", (doc_id,)
        ).fetchone()
    return dict(row) if row else None


def get_chunk_ids(doc_id: str) -> list[int]:
    """删除文档时，用这些 id 去 FAISS 里移除对应向量。"""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id FROM chunks WHERE doc_id = ?", (doc_id,)
        ).fetchall()
    return [r["id"] for r in rows]


def delete_document(doc_id: str) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))  # 级联删 chunks


# ===== chunks =====

def add_chunks(doc_id: str, items: Iterable[tuple[int, str, str]]) -> list[int]:
    """items: (chunk_index, text, source)；返回自增生成的 chunk id 列表（= FAISS 向量 id）。"""
    ids: list[int] = []
    with get_conn() as conn:
        for chunk_index, text, source in items:
            cur = conn.execute(
                "INSERT INTO chunks (doc_id, chunk_index, text, source) "
                "VALUES (?, ?, ?, ?)",
                (doc_id, chunk_index, text, source),
            )
            ids.append(cur.lastrowid)
    return ids


def get_chunks_by_ids(ids: list[int]) -> list[dict]:
    """检索命中后，按 FAISS 返回的 id 回表取文本和出处。"""
    if not ids:
        return []
    placeholders = ",".join("?" * len(ids))
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT * FROM chunks WHERE id IN ({placeholders})", ids
        ).fetchall()
    by_id = {r["id"]: dict(r) for r in rows}
    return [by_id[i] for i in ids if i in by_id]  # 保持 FAISS 的相关性顺序


def get_small_sheet_chunks(
    doc_id: str, sheet_prefix: str, max_rows: int = 50
) -> list[dict]:
    """补齐小型 XLSX 工作表；超过上限时不把截断结果当作完整表返回。

    兼容已入库的行文本格式：[工作表名] 内容，不需要重新上传。
    doc_id 约束避免把同名文件的不同上传版本混在一起。
    """
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT c.* FROM chunks c JOIN documents d ON d.id = c.doc_id "
            "WHERE c.doc_id = ? AND d.ext = 'xlsx' AND d.status = 'done' "
            "AND substr(c.text, 1, ?) = ? "
            "ORDER BY c.chunk_index LIMIT ?",
            (doc_id, len(sheet_prefix), sheet_prefix, max_rows + 1),
        ).fetchall()
    if len(rows) > max_rows:
        return []
    return [dict(row) for row in rows]
