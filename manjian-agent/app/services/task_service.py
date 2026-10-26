"""任务服务：创建 -> 运行图 -> 持久化（文档 09），含异步、取消、恢复、并发、清理（阶段 5/7）。

- request_id 幂等；后台执行，HTTP 不阻塞整条链路。
- 取消：协作式，用 astream 逐步执行，步间检查 cancel_requested。
- 恢复：启动时把崩溃残留的 running 任务重新入队重跑（图像/TTS 有缓存，重跑开销小）。
- 并发：信号量限制同时运行的任务数；单任务总时长上限。
"""
from __future__ import annotations

import asyncio
import shutil
import uuid
from datetime import UTC, datetime, timedelta
from functools import lru_cache

from app.config import Settings, get_settings
from app.domain.request import CreateTaskRequest
from app.graph.state import TaskStatus
from app.observability.logging import get_logger
from app.repositories.sqlite import TaskRepository
from app.services.assets.asset_seed import seed_demo_assets

logger = get_logger(__name__)

_SOFT_CODES = {"duration_warning", "not_implemented"}
_ACTIVE = {TaskStatus.QUEUED, TaskStatus.RUNNING, TaskStatus.CANCEL_REQUESTED}


class _Cancelled(Exception):
    pass


def _build_graph(settings: Settings, repo: TaskRepository):
    if settings.graph_mode == "multi":
        from app.graph.multi_agent_graph import build_multi_agent_graph
        return build_multi_agent_graph(settings=settings, repo=repo)
    from app.graph.single_graph import build_single_graph
    return build_single_graph(settings=settings, repo=repo)


class TaskService:
    def __init__(self, settings: Settings, repo: TaskRepository):
        self._settings = settings
        self._repo = repo
        self._graph = _build_graph(settings, repo)
        self._semaphore = asyncio.Semaphore(max(1, settings.max_concurrent_tasks))
        if settings.app_env == "dev":
            seed_demo_assets(repo)

    # ---- 创建 / 查询 ----
    def create_task(self, request: CreateTaskRequest) -> tuple[dict, bool]:
        existing = self._repo.get_by_request_id(request.request_id)
        if existing:
            logger.info("幂等命中 request_id=%s -> task=%s", request.request_id, existing["task_id"])
            return existing, False
        task_id = f"task_{uuid.uuid4().hex[:16]}"
        self._repo.create_task(task_id, request.request_id, request.model_dump(), status=TaskStatus.QUEUED)
        self._repo.add_event(task_id, "created", stage="queued")
        return self._repo.get_task(task_id), True

    def get_task(self, task_id: str) -> dict | None:
        return self._repo.get_task(task_id)

    def list_events(self, task_id: str) -> list[dict]:
        return self._repo.list_events(task_id)

    def list_artifacts(self, task_id: str) -> list[dict]:
        return self._repo.list_artifacts(task_id)

    def list_agent_runs(self, task_id: str) -> list[dict]:
        return self._repo.list_agent_runs(task_id)

    # ---- 取消 / 恢复 / 清理 ----
    def request_cancel(self, task_id: str) -> bool:
        t = self._repo.get_task(task_id)
        if t is None or t["status"] not in _ACTIVE:
            return False
        self._repo.update_task(task_id, status=TaskStatus.CANCEL_REQUESTED)
        self._repo.add_event(task_id, "cancel_requested", stage=t.get("stage"))
        return True

    def recover_orphans(self) -> list[str]:
        """启动时：把上次进程崩溃残留的 running/cancel_requested 任务重新入队。"""
        orphans = self._repo.list_by_status(TaskStatus.RUNNING) + \
            self._repo.list_by_status(TaskStatus.CANCEL_REQUESTED)
        ids = []
        for t in orphans:
            self._repo.update_task(t["task_id"], status=TaskStatus.QUEUED)
            self._repo.add_event(t["task_id"], "recovered", stage="queued")
            ids.append(t["task_id"])
        if ids:
            logger.info("恢复 %s 个中断任务，重新入队: %s", len(ids), ids)
        return ids

    def cleanup_old_tasks(self, days: int | None = None) -> int:
        days = self._settings.task_retention_days if days is None else days
        cutoff = (datetime.now(UTC) - timedelta(days=days)).isoformat()
        ids = self._repo.tasks_created_before(cutoff)
        for tid in ids:
            shutil.rmtree(self._settings.tasks_dir / tid, ignore_errors=True)
            self._repo.delete_task(tid)
        if ids:
            logger.info("清理 %s 个过期任务（>%s天）", len(ids), days)
        return len(ids)

    def metrics(self) -> dict:
        tasks = self._repo.all_tasks()
        by_status: dict[str, int] = {}
        durations: list[float] = []
        for t in tasks:
            by_status[t["status"]] = by_status.get(t["status"], 0) + 1
            if t["status"] in {TaskStatus.SUCCEEDED, TaskStatus.STORYBOARD_READY, TaskStatus.FAILED}:
                d = _duration(t["created_at"], t["updated_at"])
                if d is not None:
                    durations.append(d)
        total = len(tasks)
        done = by_status.get(TaskStatus.SUCCEEDED, 0) + by_status.get(TaskStatus.STORYBOARD_READY, 0)
        finished = done + by_status.get(TaskStatus.FAILED, 0)
        durations.sort()
        return {
            "total": total,
            "by_status": by_status,
            "success_rate": round(done / finished, 4) if finished else None,
            "avg_duration_s": round(sum(durations) / len(durations), 2) if durations else None,
            "p95_duration_s": durations[int(len(durations) * 0.95)] if durations else None,
        }

    # ---- 执行 ----
    async def run_task(self, task_id: str) -> dict:
        task = self._repo.get_task(task_id)
        if task is None:
            raise ValueError(f"task not found: {task_id}")

        async with self._semaphore:
            self._repo.update_task(task_id, status=TaskStatus.RUNNING)
            self._repo.add_event(task_id, "running", stage="running")
            init_state = {"task_id": task_id, "request": task["request"],
                          "status": TaskStatus.QUEUED, "errors": [], "llm_calls": 0}
            try:
                final = await asyncio.wait_for(
                    self._run_graph(task_id, init_state), self._settings.task_total_timeout_seconds)
            except TimeoutError:
                return self._fail(task_id, "resource_limit", "任务执行超时")
            except _Cancelled:
                self._repo.update_task(task_id, status=TaskStatus.CANCELLED, stage="cancelled")
                self._repo.add_event(task_id, "cancelled", stage="cancelled")
                logger.info("task %s 已取消", task_id)
                return self._repo.get_task(task_id)
            except Exception as exc:  # noqa: BLE001
                logger.exception("graph 执行异常 task=%s", task_id)
                return self._fail(task_id, "internal", str(exc))
            return self._persist_final(task_id, final)

    async def _run_graph(self, task_id: str, init_state: dict) -> dict:
        final = init_state
        async for snap in self._graph.astream(init_state, stream_mode="values"):
            final = snap
            cur = self._repo.get_task(task_id)
            if cur and cur["status"] == TaskStatus.CANCEL_REQUESTED:
                raise _Cancelled()
        return final

    def _fail(self, task_id: str, code: str, message: str) -> dict:
        self._repo.update_task(task_id, status=TaskStatus.FAILED, stage="error",
                               error_code=code, error_message=message)
        self._repo.add_event(task_id, "failed", stage="error", payload={"error": message})
        return self._repo.get_task(task_id)

    def _persist_final(self, task_id: str, final: dict) -> dict:
        status = final.get("status", TaskStatus.FAILED)
        stage = final.get("stage")
        errors = final.get("errors", [])
        asset_plan = final.get("asset_plan")
        render_plan = final.get("render_plan")
        result = {
            "storyboard": final.get("storyboard"),
            "asset_plan": asset_plan,
            "audio_plan": final.get("audio_plan"),
            "render_plan": render_plan,
            "subtitle_path": final.get("subtitle_path"),
            "quality_report": final.get("quality_report"),
            "warnings": [e for e in errors if e.get("code") in _SOFT_CODES],
        }
        hard = [e for e in errors if e.get("code") not in _SOFT_CODES]
        err_code = hard[0]["code"] if (status == TaskStatus.FAILED and hard) else None
        err_msg = hard[0]["message"] if (status == TaskStatus.FAILED and hard) else None
        self._repo.update_task(task_id, status=status, stage=str(stage) if stage else None,
                               result=result, error_code=err_code, error_message=err_msg)
        self._persist_task_assets(task_id, asset_plan)
        self._persist_artifacts(task_id, render_plan, final.get("subtitle_path"))
        self._repo.add_event(task_id, "finished", stage=str(stage) if stage else None,
                             payload={"status": str(status)})
        logger.info("task %s 完成 status=%s stage=%s", task_id, status, stage)
        return self._repo.get_task(task_id)

    def _persist_task_assets(self, task_id: str, asset_plan: dict | None) -> None:
        if not asset_plan:
            return
        rows = [{"scene_id": m["scene_id"], "asset_id": m["chosen_asset_id"],
                 "selection_reason": m.get("reason", "")}
                for m in asset_plan.get("scene_matches", []) if m.get("chosen_asset_id")]
        self._repo.save_task_assets(task_id, rows)

    def _persist_artifacts(self, task_id: str, render_plan: dict | None, subtitle_path: str | None) -> None:
        if render_plan and render_plan.get("output_path"):
            self._repo.save_artifact(task_id, "video", render_plan["output_path"],
                                     metadata={"duration": render_plan.get("duration_seconds"),
                                               "validated": render_plan.get("validated")})
        if subtitle_path:
            self._repo.save_artifact(task_id, "subtitle", subtitle_path)


def _duration(created: str, updated: str) -> float | None:
    try:
        return (datetime.fromisoformat(updated) - datetime.fromisoformat(created)).total_seconds()
    except Exception:  # noqa: BLE001
        return None


@lru_cache
def get_task_service() -> TaskService:
    settings = get_settings()
    repo = TaskRepository(settings.db_file)
    return TaskService(settings, repo)
