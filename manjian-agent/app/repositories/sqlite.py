"""SQLite 持久化（见文档 09 章）。

开发阶段用 SQLite + 本地文件；高并发时再迁移 PostgreSQL 与独立队列。
表：tasks、task_events、assets、task_assets。
request_id 建唯一索引实现幂等：同一 request_id 重复提交返回已有任务。
"""
from __future__ import annotations

import json
import sqlite3
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

_SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks (
    task_id      TEXT PRIMARY KEY,
    request_id   TEXT NOT NULL,
    status       TEXT NOT NULL,
    stage        TEXT,
    request_json TEXT NOT NULL,
    result_json  TEXT,
    error_code   TEXT,
    error_message TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_request_id ON tasks(request_id);

CREATE TABLE IF NOT EXISTS task_events (
    event_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    TEXT NOT NULL,
    stage      TEXT,
    event_type TEXT NOT NULL,
    payload_json TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_task ON task_events(task_id);

CREATE TABLE IF NOT EXISTS assets (
    asset_id            TEXT PRIMARY KEY,
    asset_type          TEXT NOT NULL,
    source_type         TEXT NOT NULL,
    source_name         TEXT,
    source_url          TEXT,
    local_path          TEXT,
    license_type        TEXT,
    commercial_use_allowed INTEGER NOT NULL DEFAULT 0,
    attribution_required   INTEGER NOT NULL DEFAULT 0,
    license_evidence_url   TEXT,
    license_checked_at     TEXT,
    content_hash        TEXT,
    duration            REAL,
    aspect_ratio        TEXT,
    tags_json           TEXT,
    mood                TEXT,
    quality_score       REAL NOT NULL DEFAULT 0.5,
    usage_count         INTEGER NOT NULL DEFAULT 0,
    last_used_at        TEXT,
    created_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(asset_type);

CREATE TABLE IF NOT EXISTS task_assets (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    TEXT NOT NULL,
    scene_id   TEXT NOT NULL,
    asset_id   TEXT NOT NULL,
    selection_reason TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_assets_task ON task_assets(task_id);

CREATE TABLE IF NOT EXISTS artifacts (
    artifact_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id       TEXT NOT NULL,
    artifact_type TEXT NOT NULL,
    local_path    TEXT NOT NULL,
    content_hash  TEXT,
    metadata_json TEXT,
    created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artifacts_task ON artifacts(task_id);

CREATE TABLE IF NOT EXISTS agent_runs (
    run_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id        TEXT NOT NULL,
    agent_name     TEXT NOT NULL,
    model_name     TEXT,
    status         TEXT NOT NULL,
    latency_ms     INTEGER,
    usage_json     TEXT,
    estimated_cost REAL,
    created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_task ON agent_runs(task_id);
"""


def _now() -> str:
    return datetime.now(UTC).isoformat()


class TaskRepository:
    def __init__(self, db_file: Path):
        self._db_file = db_file
        self._lock = threading.Lock()
        db_file.parent.mkdir(parents=True, exist_ok=True)
        self.init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_file, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        return conn

    def init_db(self) -> None:
        with self._lock, self._connect() as conn:
            conn.executescript(_SCHEMA)

    # ---- tasks ----
    def create_task(self, task_id: str, request_id: str, request: dict, status: str = "queued") -> None:
        now = _now()
        with self._lock, self._connect() as conn:
            conn.execute(
                "INSERT INTO tasks(task_id, request_id, status, stage, request_json, created_at, updated_at)"
                " VALUES(?,?,?,?,?,?,?)",
                (task_id, request_id, status, None, json.dumps(request, ensure_ascii=False), now, now),
            )

    def get_task(self, task_id: str) -> dict | None:
        with self._lock, self._connect() as conn:
            row = conn.execute("SELECT * FROM tasks WHERE task_id=?", (task_id,)).fetchone()
        return self._row_to_task(row) if row else None

    def get_by_request_id(self, request_id: str) -> dict | None:
        with self._lock, self._connect() as conn:
            row = conn.execute("SELECT * FROM tasks WHERE request_id=?", (request_id,)).fetchone()
        return self._row_to_task(row) if row else None

    def update_task(
        self,
        task_id: str,
        *,
        status: str | None = None,
        stage: str | None = None,
        result: dict | None = None,
        error_code: str | None = None,
        error_message: str | None = None,
    ) -> None:
        sets: list[str] = ["updated_at=?"]
        vals: list[Any] = [_now()]
        if status is not None:
            sets.append("status=?")
            vals.append(status)
        if stage is not None:
            sets.append("stage=?")
            vals.append(stage)
        if result is not None:
            sets.append("result_json=?")
            vals.append(json.dumps(result, ensure_ascii=False))
        if error_code is not None:
            sets.append("error_code=?")
            vals.append(error_code)
        if error_message is not None:
            sets.append("error_message=?")
            vals.append(error_message)
        vals.append(task_id)
        with self._lock, self._connect() as conn:
            conn.execute(f"UPDATE tasks SET {', '.join(sets)} WHERE task_id=?", vals)

    # ---- events ----
    def add_event(self, task_id: str, event_type: str, *, stage: str | None = None,
                  payload: dict | None = None) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                "INSERT INTO task_events(task_id, stage, event_type, payload_json, created_at) VALUES(?,?,?,?,?)",
                (task_id, stage, event_type, json.dumps(payload, ensure_ascii=False) if payload else None, _now()),
            )

    def list_events(self, task_id: str) -> list[dict]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT stage, event_type, payload_json, created_at FROM task_events WHERE task_id=? ORDER BY event_id",
                (task_id,),
            ).fetchall()
        out = []
        for r in rows:
            out.append(
                {
                    "stage": r["stage"],
                    "event_type": r["event_type"],
                    "payload": json.loads(r["payload_json"]) if r["payload_json"] else None,
                    "created_at": r["created_at"],
                }
            )
        return out

    # ---- assets ----
    def upsert_asset(self, asset: dict) -> None:
        a = dict(asset)
        a.setdefault("created_at", _now())
        with self._lock, self._connect() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO assets("
                "asset_id, asset_type, source_type, source_name, source_url, local_path, license_type,"
                "commercial_use_allowed, attribution_required, license_evidence_url, license_checked_at,"
                "content_hash, duration, aspect_ratio, tags_json, mood, quality_score, usage_count,"
                "last_used_at, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    a["asset_id"], a.get("asset_type", "image"), a.get("source_type", "licensed"),
                    a.get("source_name", ""), a.get("source_url", ""), a.get("local_path", ""),
                    a.get("license_type", ""), int(bool(a.get("commercial_use_allowed", False))),
                    int(bool(a.get("attribution_required", False))), a.get("license_evidence_url", ""),
                    a.get("license_checked_at", ""), a.get("content_hash", ""), a.get("duration"),
                    a.get("aspect_ratio", ""), json.dumps(a.get("tags", []), ensure_ascii=False),
                    a.get("mood", "neutral"), float(a.get("quality_score", 0.5)),
                    int(a.get("usage_count", 0)), a.get("last_used_at"), a["created_at"],
                ),
            )

    def get_asset(self, asset_id: str) -> dict | None:
        with self._lock, self._connect() as conn:
            row = conn.execute("SELECT * FROM assets WHERE asset_id=?", (asset_id,)).fetchone()
        return self._row_to_asset(row) if row else None

    def list_assets(self, asset_type: str | None = None) -> list[dict]:
        with self._lock, self._connect() as conn:
            if asset_type:
                rows = conn.execute("SELECT * FROM assets WHERE asset_type=?", (asset_type,)).fetchall()
            else:
                rows = conn.execute("SELECT * FROM assets").fetchall()
        return [self._row_to_asset(r) for r in rows]

    def count_assets(self) -> int:
        with self._lock, self._connect() as conn:
            return conn.execute("SELECT COUNT(*) AS c FROM assets").fetchone()["c"]

    def save_task_assets(self, task_id: str, rows: list[dict]) -> None:
        now = _now()
        with self._lock, self._connect() as conn:
            conn.execute("DELETE FROM task_assets WHERE task_id=?", (task_id,))
            conn.executemany(
                "INSERT INTO task_assets(task_id, scene_id, asset_id, selection_reason, created_at)"
                " VALUES(?,?,?,?,?)",
                [(task_id, r["scene_id"], r["asset_id"], r.get("selection_reason", ""), now) for r in rows],
            )

    def list_task_assets(self, task_id: str) -> list[dict]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT scene_id, asset_id, selection_reason FROM task_assets WHERE task_id=? ORDER BY id",
                (task_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    # ---- artifacts ----
    def save_artifact(self, task_id: str, artifact_type: str, local_path: str, *,
                      content_hash: str | None = None, metadata: dict | None = None) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                "INSERT INTO artifacts(task_id, artifact_type, local_path, content_hash, metadata_json, created_at)"
                " VALUES(?,?,?,?,?,?)",
                (task_id, artifact_type, local_path, content_hash,
                 json.dumps(metadata, ensure_ascii=False) if metadata else None, _now()),
            )

    def list_artifacts(self, task_id: str) -> list[dict]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT artifact_type, local_path, content_hash, metadata_json, created_at"
                " FROM artifacts WHERE task_id=? ORDER BY artifact_id", (task_id,),
            ).fetchall()
        return [
            {"artifact_type": r["artifact_type"], "local_path": r["local_path"],
             "content_hash": r["content_hash"],
             "metadata": json.loads(r["metadata_json"]) if r["metadata_json"] else None,
             "created_at": r["created_at"]}
            for r in rows
        ]

    # ---- agent runs（成本/用量观测，阶段 7）----
    def add_agent_run(self, task_id: str, agent_name: str, *, model_name: str | None = None,
                      status: str = "ok", latency_ms: int | None = None,
                      usage: dict | None = None, estimated_cost: float | None = None) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                "INSERT INTO agent_runs(task_id, agent_name, model_name, status, latency_ms,"
                " usage_json, estimated_cost, created_at) VALUES(?,?,?,?,?,?,?,?)",
                (task_id, agent_name, model_name, status, latency_ms,
                 json.dumps(usage, ensure_ascii=False) if usage else None, estimated_cost, _now()),
            )

    def list_agent_runs(self, task_id: str) -> list[dict]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT agent_name, model_name, status, latency_ms, usage_json, estimated_cost, created_at"
                " FROM agent_runs WHERE task_id=? ORDER BY run_id", (task_id,)).fetchall()
        return [{"agent_name": r["agent_name"], "model_name": r["model_name"], "status": r["status"],
                 "latency_ms": r["latency_ms"],
                 "usage": json.loads(r["usage_json"]) if r["usage_json"] else None,
                 "estimated_cost": r["estimated_cost"], "created_at": r["created_at"]} for r in rows]

    # ---- 运维 / 查询（阶段 5-7）----
    def list_by_status(self, status: str) -> list[dict]:
        with self._lock, self._connect() as conn:
            rows = conn.execute("SELECT * FROM tasks WHERE status=? ORDER BY created_at", (status,)).fetchall()
        return [self._row_to_task(r) for r in rows]

    def all_tasks(self) -> list[dict]:
        with self._lock, self._connect() as conn:
            rows = conn.execute("SELECT * FROM tasks ORDER BY created_at").fetchall()
        return [self._row_to_task(r) for r in rows]

    def tasks_created_before(self, iso_cutoff: str) -> list[str]:
        with self._lock, self._connect() as conn:
            rows = conn.execute("SELECT task_id FROM tasks WHERE created_at < ?", (iso_cutoff,)).fetchall()
        return [r["task_id"] for r in rows]

    def delete_task(self, task_id: str) -> None:
        with self._lock, self._connect() as conn:
            conn.execute("DELETE FROM task_events WHERE task_id=?", (task_id,))
            conn.execute("DELETE FROM task_assets WHERE task_id=?", (task_id,))
            conn.execute("DELETE FROM artifacts WHERE task_id=?", (task_id,))
            conn.execute("DELETE FROM tasks WHERE task_id=?", (task_id,))

    # ---- row mappers ----
    @staticmethod
    def _row_to_task(row: sqlite3.Row) -> dict:
        return {
            "task_id": row["task_id"],
            "request_id": row["request_id"],
            "status": row["status"],
            "stage": row["stage"],
            "request": json.loads(row["request_json"]),
            "result": json.loads(row["result_json"]) if row["result_json"] else None,
            "error_code": row["error_code"],
            "error_message": row["error_message"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    @staticmethod
    def _row_to_asset(row: sqlite3.Row) -> dict:
        return {
            "asset_id": row["asset_id"],
            "asset_type": row["asset_type"],
            "source_type": row["source_type"],
            "source_name": row["source_name"],
            "source_url": row["source_url"],
            "local_path": row["local_path"],
            "license_type": row["license_type"],
            "commercial_use_allowed": bool(row["commercial_use_allowed"]),
            "attribution_required": bool(row["attribution_required"]),
            "license_evidence_url": row["license_evidence_url"],
            "license_checked_at": row["license_checked_at"],
            "content_hash": row["content_hash"],
            "duration": row["duration"],
            "aspect_ratio": row["aspect_ratio"],
            "tags": json.loads(row["tags_json"]) if row["tags_json"] else [],
            "mood": row["mood"],
            "quality_score": row["quality_score"],
            "usage_count": row["usage_count"],
            "last_used_at": row["last_used_at"],
            "created_at": row["created_at"],
        }
