"""视频任务 Worker：领取任务 -> 提交 -> 轮询 -> 转存结果。

设计要点：
- 每次领取只推进“一步”，然后释放租约并设置 next_poll_at，
  所以单个 Worker 可以交替处理多个任务，进程重启也能从数据库恢复。
- 提交前先落库 attempt（含 request_token），提交结果不确定时宁可标记失败交给人确认，
  也不自动重提，避免重复扣费。
- 所有状态变更走 repo.transition 的条件更新，已取消/已结束的任务不会被旧结果覆盖。

独立运行：python -m app.workers.video_worker
"""
import asyncio
import logging
import tempfile
import uuid
from datetime import timedelta
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.exceptions import ProviderError, ValidationFailed
from app.core.logging import redact, setup_logging, task_log
from app.core.time import utcnow
from app.db.session import SessionLocal
from app.domain.status import SUBMIT_UNCERTAIN_CODE, TaskStatus
from app.models import VideoTask
from app.providers.base import ImagePart, ProviderStatus, SubmitRequest, VideoProvider
from app.providers.factory import get_provider
from app.providers.media import validate_video
from app.repositories.account_repository import AccountRepository
from app.repositories.uploaded_file_repository import UploadedFileRepository
from app.repositories.video_task_repository import VideoTaskRepository
from app.scheduling.window import is_window_open
from app.services.account_service import load_config
from app.storage.base import Storage
from app.storage.factory import get_storage

logger = logging.getLogger("video_worker")


class VideoWorker:
    def __init__(self, settings: Settings, provider: VideoProvider, storage: Storage) -> None:
        self.s, self.provider, self.storage = settings, provider, storage
        self.worker_id = f"worker-{uuid.uuid4().hex[:8]}"

    # ---------- 主循环 ----------
    async def run_forever(self, stop: asyncio.Event | None = None) -> None:
        logger.info("worker started id=%s provider=%s", self.worker_id, self.provider.name)
        while not (stop and stop.is_set()):
            try:
                worked = await self.run_once()
            except Exception:  # 单次异常不能让 Worker 退出
                logger.exception("worker loop error")
                worked = False
            if not worked:
                await asyncio.sleep(self.s.worker_idle_sleep_seconds)

    async def run_once(self) -> bool:
        """领取并处理一个任务；没有可处理的任务返回 False。"""
        with SessionLocal() as db:
            repo = VideoTaskRepository(db)
            # 费用控制：GPU 上已有足够多任务时不再提交新任务；夜间窗口关闭时不提交“夜间”任务
            task = repo.claim_next(
                self.worker_id, self.s.worker_lease_seconds,
                include_pending=repo.count_inflight() < self.s.generation_max_inflight,
                window_open=is_window_open(utcnow(), self.s),
            )
            if not task:
                return False
            try:
                await self._step(db, repo, task)
            except Exception as e:
                # 未预期的异常：记录并让任务稍后重试，避免卡死在租约里
                db.rollback()
                logger.exception(task_log(task.id, "worker_unexpected_error"))
                repo.add_event(task.id, "worker_error", message=redact(f"{type(e).__name__}: {e}")[:300])
                repo.release(task.id, self.worker_id, utcnow() + timedelta(seconds=30))
                db.commit()
            return True

    async def _step(self, db: Session, repo: VideoTaskRepository, task: VideoTask) -> None:
        if task.status == TaskStatus.PENDING.value:
            await self._submit(db, repo, task)
        else:
            await self._poll(db, repo, task)

    # ---------- 提交 ----------
    async def _submit(self, db: Session, repo: VideoTaskRepository, task: VideoTask) -> None:
        last = repo.latest_attempt(task.id)
        if last and last.status == "started":
            # 上一次提交开始了但没有结论（进程崩溃）：外部任务可能已存在，不自动重提
            last.status, last.completed_at = "failed", utcnow()
            last.error_code = SUBMIT_UNCERTAIN_CODE
            self._fail(repo, task, SUBMIT_UNCERTAIN_CODE, "上次提交中断，无法确认外部任务是否已创建")
            db.commit()
            return

        try:
            req = self._build_request(db, task)
        except ValidationFailed as e:  # 账号类型的生成配置不合法：提交前就失败，不产生费用
            self._fail(repo, task, "PROVIDER_NOT_CONFIGURED", e.message)
            db.commit()
            return
        attempt = repo.create_attempt(task.id, req.request_token)
        repo.add_event(task.id, "provider_submit_started", message=f"attempt={attempt.attempt_number}")
        db.commit()  # 先落库再提交：崩溃后至少知道“尝试过”

        try:
            provider_task_id = await self.provider.submit(req)
        except ProviderError as e:
            self._handle_submit_error(db, repo, task, attempt, e)
            return

        attempt.provider_task_id, attempt.status = provider_task_id, "submitted"
        ok = repo.transition(
            task.id, [TaskStatus.PENDING], TaskStatus.SUBMITTED, event_type="provider_submitted",
            message=f"provider_task_id={provider_task_id}",
            values=dict(provider_task_id=provider_task_id, started_at=utcnow(), submit_retry_count=0),
        )
        if ok:
            repo.release(task.id, self.worker_id, utcnow() + timedelta(seconds=self.s.autodl_poll_interval_seconds))
        db.commit()
        logger.info(task_log(task.id, "provider_submitted", provider_task_id=provider_task_id, applied=ok))

    def _handle_submit_error(self, db, repo, task, attempt, e: ProviderError) -> None:
        msg = redact(e.message, [self.s.autodl_api_token])
        attempt.completed_at, attempt.error_code, attempt.error_message = utcnow(), e.code, msg
        attempt.status = "failed"
        if e.submit_uncertain:
            self._fail(repo, task, SUBMIT_UNCERTAIN_CODE, f"提交结果不确定，外部任务可能已创建：{msg}")
        elif e.retryable and task.submit_retry_count < self.s.submit_max_retries:
            # 确定没到达服务端（如连接失败），可安全重试
            delay = 5 * (2 ** task.submit_retry_count)
            repo.update_fields(task.id, {"submit_retry_count": task.submit_retry_count + 1})
            repo.add_event(task.id, "provider_submit_retry", message=f"{e.code}，{delay}s 后重试")
            repo.release(task.id, self.worker_id, utcnow() + timedelta(seconds=delay))
        else:
            self._fail(repo, task, e.code, msg)
        db.commit()

    def _build_request(self, db: Session, task: VideoTask) -> SubmitRequest:
        files = UploadedFileRepository(db)
        images: list[ImagePart] = []
        for file_id in task.input_file_ids or []:
            f = files.get(file_id)
            if f:
                # 内联方式需要图片字节；url 方式只需要地址。两个都准备，由 Provider 按配置选择
                images.append(ImagePart(self.storage.read_bytes(f.storage_key), f.content_type,
                                        self.storage.get_url(f.storage_key)))
        # 工作流 ID 和请求字段名在数据库里（账号类型的生成配置），提交时现查，改了立即对新提交生效
        account = AccountRepository(db).get(task.account_id) if task.account_id else None
        config = load_config(account) if account else None
        return SubmitRequest(
            request_token=str(uuid.uuid4()), workflow_key=task.workflow_key, prompt=task.prompt,
            negative_prompt=task.negative_prompt, aspect_ratio=task.aspect_ratio,
            duration_seconds=task.duration_seconds, resolution=task.resolution, seed=task.seed,
            dialogue=task.dialogue, images=images, config=config,
        )

    # ---------- 轮询 ----------
    async def _poll(self, db: Session, repo: VideoTaskRepository, task: VideoTask) -> None:
        started = task.started_at or task.created_at
        elapsed = (utcnow() - started).total_seconds()
        if elapsed > self.s.autodl_max_poll_seconds:
            self._fail(repo, task, "POLL_TIMEOUT", "等待视频生成超时，外部任务状态未知，请到 AutoDL 控制台确认")
            db.commit()
            return

        try:
            status = await self.provider.get_status(task.provider_task_id or "")
        except ProviderError as e:
            msg = redact(e.message, [self.s.autodl_api_token])
            if e.retryable:
                repo.add_event(task.id, "provider_poll_error", message=f"{e.code}: {msg}")
                self._reschedule(repo, task, elapsed, backoff=True)
            else:
                self._fail(repo, task, e.code, msg)
            db.commit()
            return

        if status.status == TaskStatus.SUCCEEDED:
            await self._finish_success(db, repo, task, status)
        elif status.status == TaskStatus.FAILED:
            self._fail(repo, task, status.error_code or "PROVIDER_TASK_FAILED",
                       redact(status.error_message or "外部任务失败", [self.s.autodl_api_token]))
            db.commit()
        else:
            if task.status == TaskStatus.SUBMITTED.value:
                repo.transition(task.id, [TaskStatus.SUBMITTED], TaskStatus.RUNNING, event_type="provider_running")
            self._reschedule(repo, task, elapsed)
            db.commit()

    def _reschedule(self, repo: VideoTaskRepository, task: VideoTask, elapsed: float, backoff: bool = False) -> None:
        """轮询间隔随运行时长逐步拉长，上限 autodl_poll_max_interval_seconds。"""
        base = self.s.autodl_poll_interval_seconds * (1 + elapsed / 120)
        delay = min(base * (2 if backoff else 1), self.s.autodl_poll_max_interval_seconds)
        repo.release(task.id, self.worker_id, utcnow() + timedelta(seconds=delay))

    # ---------- 成功：下载 -> 校验 -> 转存 -> 标记 ----------
    async def _finish_success(self, db, repo, task: VideoTask, status: ProviderStatus) -> None:
        key = f"videos/{task.id}.mp4"
        try:
            with tempfile.TemporaryDirectory() as tmp:
                tmp_file = Path(tmp) / "result.mp4"
                content_type = await self.provider.download_result(status, tmp_file, self.s.max_result_bytes)
                await validate_video(tmp_file)
                size = tmp_file.stat().st_size
                self.storage.save_file(key, tmp_file)
        except ProviderError as e:
            msg = redact(e.message, [self.s.autodl_api_token])
            if e.retryable and task.submit_retry_count < self.s.submit_max_retries:
                # 借用 submit_retry_count 记录下载重试次数；任务本身已在外部成功，只重试下载
                repo.update_fields(task.id, {"submit_retry_count": task.submit_retry_count + 1})
                repo.add_event(task.id, "result_download_retry", message=msg)
                repo.release(task.id, self.worker_id, utcnow() + timedelta(seconds=10))
            else:
                self._fail(repo, task, e.code, msg)
            db.commit()
            return

        ok = repo.transition(
            task.id, [TaskStatus.SUBMITTED, TaskStatus.RUNNING], TaskStatus.SUCCEEDED,
            event_type="result_saved",
            values=dict(result_storage_key=key, result_content_type=content_type, result_size_bytes=size,
                        completed_at=utcnow(), claimed_by=None, lease_expires_at=None, error_code=None, error_message=None),
        )
        if not ok:
            # 期间任务已被取消：丢弃刚保存的文件
            self.storage.delete(key)
        latest = repo.latest_attempt(task.id)
        if ok and latest:
            latest.status, latest.completed_at = "succeeded", utcnow()
        db.commit()
        logger.info(task_log(task.id, "result_saved", applied=ok, size=size))

    # ---------- 失败 ----------
    def _fail(self, repo: VideoTaskRepository, task: VideoTask, code: str, message: str) -> None:
        ok = repo.transition(
            task.id, [TaskStatus.PENDING, TaskStatus.SUBMITTED, TaskStatus.RUNNING], TaskStatus.FAILED,
            event_type="task_failed", message=f"{code}: {message}"[:500],
            values=dict(error_code=code, error_message=message[:1000], completed_at=utcnow(),
                        claimed_by=None, lease_expires_at=None),
        )
        logger.warning(task_log(task.id, "task_failed", code=code, applied=ok))


def main() -> None:
    s = get_settings()
    setup_logging(s.log_level)
    worker = VideoWorker(s, get_provider(), get_storage())
    asyncio.run(worker.run_forever())


if __name__ == "__main__":
    main()
