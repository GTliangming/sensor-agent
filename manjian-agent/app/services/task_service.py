"""任务服务：创建 -> 运行图 -> 持久化（文档 09），含异步、取消、恢复、并发、清理（阶段 5/7）。

- request_id 幂等；后台执行，HTTP 不阻塞整条链路。
- 取消：监视器轮询 cancel_requested，运行中的节点也会被中断（见 _cancellable）。
- 恢复：启动时把崩溃残留的 running 任务重新入队重跑（图像/TTS 有缓存，重跑开销小）。
- 并发：信号量限制同时运行的任务数；单任务总时长上限。
"""
from __future__ import annotations

import asyncio
import shutil
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Any, TypeVar

import aiosqlite
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from pydantic import ValidationError

from app.config import Settings, get_settings
from app.domain.plans import AssetPlan, AudioPlan
from app.domain.request import CreateTaskRequest
from app.domain.storyboard import Storyboard
from app.graph.hitl_graph import GATE_BY_NODE, GATE_FIELD, build_hitl_graph
from app.graph.state import TaskStatus
from app.observability.logging import get_logger
from app.repositories.sqlite import TaskRepository
from app.services.assets.asset_seed import seed_demo_assets

logger = get_logger(__name__)

_SOFT_CODES = {"duration_warning", "not_implemented"}
_ACTIVE = {TaskStatus.QUEUED, TaskStatus.RUNNING, TaskStatus.CANCEL_REQUESTED}
_REVIEW_ACTIONS = {"approve", "edit", "regenerate", "cancel"}

T = TypeVar("T")


class _Cancelled(Exception):
    pass


class ReviewError(ValueError):
    """人工审核请求非法（动作、状态或编辑内容不合规）；API 层映射为 4xx。"""


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
        # HITL 专用图：暂停点存 SQLite（AsyncSqliteSaver），进程重启后仍可 resume。
        # 连接绑定事件循环，故在首次使用时惰性创建（见 _get_hitl_graph）。
        self._hitl_graph: Any = None
        self._hitl_conn: aiosqlite.Connection | None = None
        self._hitl_loop: asyncio.AbstractEventLoop | None = None
        self._hitl_lock: asyncio.Lock | None = None
        self._hitl_lock_loop: asyncio.AbstractEventLoop | None = None
        self._semaphore = asyncio.Semaphore(max(1, settings.max_concurrent_tasks))
        if settings.app_env == "dev":
            seed_demo_assets(repo)

    # ---- HITL 图 / checkpoint 生命周期 ----
    async def _get_hitl_graph(self):
        loop = asyncio.get_running_loop()
        if self._hitl_graph is not None and self._hitl_loop is loop:
            return self._hitl_graph
        if self._hitl_lock is None or self._hitl_lock_loop is not loop:
            self._hitl_lock = asyncio.Lock()
            self._hitl_lock_loop = loop
        async with self._hitl_lock:
            if self._hitl_graph is not None and self._hitl_loop is loop:
                return self._hitl_graph
            await self._close_hitl_conn()
            path = self._settings.checkpoint_file
            path.parent.mkdir(parents=True, exist_ok=True)
            conn = await aiosqlite.connect(str(path))
            saver = AsyncSqliteSaver(conn)
            await saver.setup()
            self._hitl_conn = conn
            self._hitl_loop = loop
            self._hitl_graph = build_hitl_graph(
                settings=self._settings, repo=self._repo, checkpointer=saver)
            return self._hitl_graph

    async def _close_hitl_conn(self) -> None:
        conn, self._hitl_conn, self._hitl_graph = self._hitl_conn, None, None
        if conn is None:
            return
        try:
            await conn.close()
        except Exception:  # noqa: BLE001 - 旧事件循环已关闭时关闭失败可忽略
            logger.debug("关闭旧 checkpoint 连接失败（忽略）", exc_info=True)

    async def aclose(self) -> None:
        await self._close_hitl_conn()

    async def reconcile_review_tasks(self) -> list[str]:
        """启动时：待审任务若丢了 checkpoint（库被删等），标记失败，避免永远卡在 awaiting_review。"""
        lost: list[str] = []
        for t in self._repo.list_by_status(TaskStatus.AWAITING_REVIEW):
            graph = await self._get_hitl_graph()
            state = await graph.aget_state({"configurable": {"thread_id": t["task_id"]}})
            if not state.next:
                self._fail(t["task_id"], "checkpoint_lost", "审核暂停点已丢失，无法继续，请重新创建任务")
                lost.append(t["task_id"])
        if lost:
            logger.warning("待审任务丢失 checkpoint，已置失败: %s", lost)
        return lost

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

        if bool((task.get("request") or {}).get("hitl")):
            init_state = {"task_id": task_id, "request": task["request"],
                          "status": TaskStatus.QUEUED, "errors": [], "llm_calls": 0, "hitl": True}
            return await self._drive_hitl(task_id, init_state)

        init_state = {"task_id": task_id, "request": task["request"],
                      "status": TaskStatus.QUEUED, "errors": [], "llm_calls": 0}
        final, terminal = await self._guarded(task_id, lambda: self._run_graph(init_state))
        return terminal or self._persist_final(task_id, final)

    async def _guarded(self, task_id: str, make_work: Callable[[], Awaitable[T]]) -> tuple[T | None, dict | None]:
        """并发信号量 + 总超时 + 取消 + 异常兜底的统一执行壳（普通图与 HITL 图共用）。

        成功返回 (结果, None)；超时/取消/异常已落库，返回 (None, 终态任务)。
        """
        async with self._semaphore:
            self._repo.update_task(task_id, status=TaskStatus.RUNNING)
            self._repo.add_event(task_id, "running", stage="running")
            try:
                result = await asyncio.wait_for(
                    self._cancellable(task_id, make_work()), self._settings.task_total_timeout_seconds)
            except TimeoutError:
                return None, self._fail(task_id, "resource_limit", "任务执行超时")
            except _Cancelled:
                self._repo.update_task(task_id, status=TaskStatus.CANCELLED, stage="cancelled")
                self._repo.add_event(task_id, "cancelled", stage="cancelled")
                logger.info("task %s 已取消", task_id)
                return None, self._repo.get_task(task_id)
            except Exception as exc:  # noqa: BLE001
                logger.exception("graph 执行异常 task=%s", task_id)
                return None, self._fail(task_id, "internal", str(exc))
            return result, None

    async def _cancellable(self, task_id: str, coro: Awaitable[T]) -> T:
        """运行 coro，同时轮询取消请求；一旦收到就中断当前节点（不必等到节点边界）。

        注意：已丢进线程池的 ffmpeg/ffprobe 无法被强杀，等待会被打断，但线程会自然跑完。
        """
        work = asyncio.ensure_future(coro)
        hit = False

        async def _watch() -> None:
            nonlocal hit
            while True:
                await asyncio.sleep(self._settings.cancel_poll_seconds)
                cur = self._repo.get_task(task_id)
                if cur and cur["status"] == TaskStatus.CANCEL_REQUESTED:
                    hit = True
                    work.cancel()
                    return

        watcher = asyncio.ensure_future(_watch())
        try:
            return await work
        except asyncio.CancelledError:
            if hit:
                raise _Cancelled() from None
            raise
        finally:
            watcher.cancel()

    # ---- HITL 人工介入 ----
    async def resume_task(self, task_id: str, action: str,
                          feedback: str | None = None, edit: object | None = None) -> dict:
        """人工在某个闸门做出决策后，继续推进图。action: approve/edit/regenerate/cancel。"""
        task = self.validate_review(task_id, action, edit)
        graph = await self._get_hitl_graph()
        config = {"configurable": {"thread_id": task_id}}
        gstate = await graph.aget_state(config)
        pending = gstate.next[0] if gstate.next else None
        gate = GATE_BY_NODE.get(pending or "")
        if gate is None:
            # 暂停点丢失（checkpoint 库被删/损坏）：不能继续，明确失败而不是卡死
            return self._fail(task_id, "checkpoint_lost", "审核暂停点已丢失，无法继续，请重新创建任务")

        if action == "cancel":
            self._repo.update_task(task_id, status=TaskStatus.CANCELLED, stage="cancelled")
            self._repo.add_event(task_id, "cancelled", stage="cancelled", payload={"gate": gate})
            logger.info("task %s 人工取消于闸门 %s", task_id, gate)
            return self._repo.get_task(task_id)

        updates: dict = {"review_action": action, "review_feedback": feedback or None}
        if action == "edit":
            self._apply_edit(task_id, gate, self._normalize_edit(task, gate, edit), gstate.values, updates)
        await graph.aupdate_state(config, updates)
        self._repo.add_event(task_id, "review", stage=gate, payload={"action": action})
        return await self._drive_hitl(task_id, None)

    def validate_review(self, task_id: str, action: str, edit: object | None) -> dict:
        """同步校验人工审核请求（状态、动作、edit 内容）；非法抛 ReviewError。返回任务行。

        API 层在受理前调用，非法请求立即得到 4xx，而不是 202 之后在后台悄悄失败。
        """
        task = self._repo.get_task(task_id)
        if task is None:
            raise ValueError(f"task not found: {task_id}")
        if task["status"] != TaskStatus.AWAITING_REVIEW:
            raise ReviewError(f"task {task_id} 不在待审状态（当前 {task['status']}）")
        if action not in _REVIEW_ACTIONS:
            raise ReviewError(f"非法审核动作: {action}")
        if action == "edit":
            self._normalize_edit(task, str(task.get("stage")), edit)
        return task

    def _normalize_edit(self, task: dict, gate: str, edit: object | None) -> Any:
        """按闸门校验人工编辑内容并规整化；不合规抛 ReviewError，保证坏数据进不了图。"""
        if edit is None:
            raise ReviewError("action=edit 必须提供 edit 内容")
        result = task.get("result") or {}
        try:
            if gate == "storyboard":
                sb = Storyboard.model_validate(edit)
                max_scenes = CreateTaskRequest.model_validate(task["request"]).max_scenes
                if len(sb.scenes) > max_scenes:
                    raise ReviewError(f"场景数 {len(sb.scenes)} 超过 max_scenes={max_scenes}")
                return sb.model_dump()
            if gate in ("assets", "images"):
                plan = AssetPlan.model_validate(edit)
                known = {s["scene_id"] for s in (result.get("storyboard") or {}).get("scenes", [])}
                unknown = {m.scene_id for m in plan.scene_matches} - known
                if known and unknown:
                    raise ReviewError(f"素材方案包含分镜中不存在的 scene_id: {sorted(unknown)}")
                return plan.model_dump()
            if gate == "tts":
                return AudioPlan.model_validate(edit).model_dump()
            if gate == "clips":
                return self._check_clips(edit)
            if gate == "subtitles":
                text = edit.get("srt") if isinstance(edit, dict) else edit
                if not isinstance(text, str) or not text.strip():
                    raise ReviewError('字幕编辑需要非空文本，格式 {"srt": "..."}')
                return text
        except ValidationError as exc:
            raise ReviewError(f"edit 不符合 {gate} 结构: {exc.error_count()} 处错误: {exc.errors()[:3]}") from exc
        raise ReviewError(f"当前闸门不支持编辑: {gate}")

    @staticmethod
    def _check_clips(edit: object) -> list[dict]:
        if not isinstance(edit, list) or not edit:
            raise ReviewError("clips 编辑需要非空数组")
        for c in edit:
            if not isinstance(c, dict) or not {"scene_id", "order", "duration", "clip_path"} <= c.keys():
                raise ReviewError("每个 clip 需含 scene_id/order/duration/clip_path")
            try:
                bad = float(c["duration"]) <= 0 or not Path(str(c["clip_path"])).is_file()
            except (TypeError, ValueError):
                bad = True
            if bad:
                raise ReviewError(f"clip 时长非法或文件不存在: {c.get('scene_id')}")
        return edit

    def _apply_edit(self, task_id: str, gate: str, edit: object,
                    values: dict, updates: dict) -> None:
        """把人工编辑的产物落地：字幕写回 srt 文件，其余替换对应 state 字段。"""
        field = GATE_FIELD[gate]
        if gate == "subtitles":
            srt_path = values.get("subtitle_path")
            text = edit.get("srt") if isinstance(edit, dict) else edit
            if srt_path and isinstance(text, str) and text.strip():
                Path(srt_path).write_text(text, encoding="utf-8")
                logger.info("task %s 人工改写字幕 %s", task_id, srt_path)
            return
        updates[field] = edit

    async def _drive_hitl(self, task_id: str, graph_input: dict | None) -> dict:
        """运行一段 HITL 图：到下一个闸门暂停或跑完。graph_input=None 表示 resume。"""
        result, terminal = await self._guarded(task_id, lambda: self._stream_hitl(task_id, graph_input))
        if terminal:
            return terminal
        values, pending = result
        if pending and pending in GATE_BY_NODE:
            return self._persist_awaiting(task_id, GATE_BY_NODE[pending], values)
        return self._persist_final(task_id, values)

    async def _stream_hitl(self, task_id: str, graph_input: dict | None) -> tuple[dict, str | None]:
        graph = await self._get_hitl_graph()
        config = {"configurable": {"thread_id": task_id}}
        async for _snap in graph.astream(graph_input, config, stream_mode="values"):
            pass
        gstate = await graph.aget_state(config)
        pending = gstate.next[0] if gstate.next else None
        return dict(gstate.values), pending

    def _persist_awaiting(self, task_id: str, gate: str, values: dict) -> dict:
        """在闸门暂停：落库 awaiting_review，并把待审产物放进 result 供前端展示。"""
        field = GATE_FIELD[gate]
        errors = values.get("errors", [])
        result = {
            "storyboard": values.get("storyboard"),
            "asset_plan": values.get("asset_plan"),
            "audio_plan": values.get("audio_plan"),
            "render_plan": values.get("render_plan"),
            "subtitle_path": values.get("subtitle_path"),
            "scene_clips": values.get("scene_clips"),
            "review": {
                "gate": gate,
                "field": field,
                "artifact": values.get(field),
                "actions": ["approve", "edit", "regenerate", "cancel"],
            },
            "warnings": [e for e in errors if e.get("code") in _SOFT_CODES],
        }
        self._repo.update_task(task_id, status=TaskStatus.AWAITING_REVIEW, stage=gate, result=result)
        self._repo.add_event(task_id, "awaiting_review", stage=gate, payload={"gate": gate})
        logger.info("task %s 暂停于闸门 %s 等待人工", task_id, gate)
        return self._repo.get_task(task_id)


    async def _run_graph(self, init_state: dict) -> dict:
        final = init_state
        async for snap in self._graph.astream(init_state, stream_mode="values"):
            final = snap
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
