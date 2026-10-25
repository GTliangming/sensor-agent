import json
import sqlite3
from pathlib import Path


STATE_DB = Path(__file__).resolve().parent.parent / "langgraph_state.sqlite3"


def initialize_run_store():
    with sqlite3.connect(STATE_DB, timeout=30) as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS pending_runs (
                thread_id TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)


def save_pending_run(thread_id: str, payload: dict):
    with sqlite3.connect(STATE_DB, timeout=30) as connection:
        connection.execute(
            "INSERT OR REPLACE INTO pending_runs (thread_id, payload) VALUES (?, ?)",
            (thread_id, json.dumps(payload, ensure_ascii=False))
        )


def get_pending_run(thread_id: str):
    with sqlite3.connect(STATE_DB, timeout=30) as connection:
        row = connection.execute(
            "SELECT payload FROM pending_runs WHERE thread_id = ?",
            (thread_id,)
        ).fetchone()
    return json.loads(row[0]) if row else None


def delete_pending_run(thread_id: str):
    with sqlite3.connect(STATE_DB, timeout=30) as connection:
        connection.execute(
            "DELETE FROM pending_runs WHERE thread_id = ?",
            (thread_id,)
        )


initialize_run_store()
