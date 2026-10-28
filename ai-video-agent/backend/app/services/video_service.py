"""视频任务业务逻辑（API 侧）：创建、查询、重试、取消。

耗时的外部调用都在 Worker 里，这里只改数据库，所以接口能快速返回。
"""
import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.exceptions import NotFoundError, QuotaExceeded, StateConflict, ValidationFailed
from app.core.time import utcnow
from app.domain.generation_config import GenerationConfig
from app.domain.status import (
    NON_RETRYABLE_ERROR_CODES,
    SUBMIT_UNCERTAIN_CODE,
    ACTIVE_STATUSES,
    TaskStatus,
)
from app.models import Account, VideoTask
from app.repositories.account_repository import AccountRepository
from app.repositories.uploaded_file_repository import UploadedFileRepository
from app.repositories.video_task_repository import VideoTaskRepository
from app.scheduling.window import is_window_open, next_window_start
from app.schemas.video import (
    CancelResult, TaskEventOut, VideoCreateRequest, VideoListData,
    VideoResult, VideoTaskDetail, VideoTaskListItem,
)
from app.services.account_service import load_config
from app.services.template_service import TemplateService
from app.storage.base import Storage


class VideoService:
    def __init__(self, db: Session, storage: Storage, settings: Settings) -> None:
        self.db, self.storage, self.s = db, storage, settings
        self.accounts = AccountRepository(db)
        self.repo = VideoTaskRepository(db)
        self.files = UploadedFileRepository(db)

    # ---------- 创建 ----------
    def create(self, req: VideoCreateRequest, idempotency_key: str | None) -> tuple[VideoTask, bool]:
        """返回 (任务, 是否新建)。相同 Idempotency-Key 重复提交返回原任务。"""
        if idempotency_key:
            existing = self.repo.get_by_idempotency_key(idempotency_key)
            if existing:
                return existing, False

        account = self.accounts.get(req.account_id)
        if not account or not account.is_active:
            raise ValidationFailed("账号类型不存在或已停用")
        config = load_config(account)
        option, duration = self.validate_params(config, req.resolution, req.duration_seconds, req.image_ids)
        if len(req.prompt) > self.s.max_prompt_length:
            raise ValidationFailed(f"提示词不能超过 {self.s.max_prompt_length} 字")
        if self.repo.count_active() >= self.s.max_active_tasks:
            raise QuotaExceeded(f"进行中的任务已达上限（{self.s.max_active_tasks}），请等待完成后再提交")
        # 负向提示词也要一并发送：有负向字段就单独传，没有就拼到 prompt 末尾
        final_prompt, negative_to_send = TemplateService(self.db).with_negative(
            account, config, req.prompt.strip(), req.negative_prompt)
        if len(final_prompt) > self.s.max_prompt_length:
            raise ValidationFailed(f"提示词（含负向提示词）不能超过 {self.s.max_prompt_length} 字")

        task = VideoTask(
            id=str(uuid.uuid4()), status=TaskStatus.PENDING.value, account_id=account.id,
            prompt=final_prompt, negative_prompt=negative_to_send,
            input_file_ids=req.image_ids, aspect_ratio=option.aspect_ratio, resolution=option.label,
            duration_seconds=duration, seed=req.seed if req.seed is not None else config.seed,
            workflow_key=account.workflow_key, provider_name=self.s.video_provider, idempotency_key=idempotency_key,
            schedule_mode="window" if req.run_mode == "night" else "now",
        )
        try:
            self.repo.add(task)
            self.repo.add_event(task.id, "task_created", to_status=task.status)
            self.db.commit()
        except IntegrityError:
            # 并发的相同幂等键：唯一索引拦住了第二个，返回先到的那个
            self.db.rollback()
            if idempotency_key and (existing := self.repo.get_by_idempotency_key(idempotency_key)):
                return existing, False
            raise
        return task, True

    # ---------- 校验与内部创建 ----------
    def validate_params(self, config: GenerationConfig, resolution: str | None, duration: int | None,
                        image_ids: list[str]):
        """按账号类型的生成配置（存数据库）校验参数，返回 (视频方向选项, 实际时长)。
        直接创建和生产流程创建共用。"""
        option = config.resolution(resolution)
        if not option:
            raise ValidationFailed(f"不支持的视频方向: {resolution}")
        duration = duration or config.default_duration
        if not config.min_duration <= duration <= config.max_duration:
            raise ValidationFailed(f"时长需在 {config.min_duration}-{config.max_duration} 秒之间")
        if config.requires_image and not image_ids:
            raise ValidationFailed("该账号类型需要先上传参考图片")
        if len(image_ids) > config.max_images:
            raise ValidationFailed(f"参考图片最多 {config.max_images} 张")
        if len(set(image_ids)) != len(image_ids):
            raise ValidationFailed("参考图片重复")
        missing = [i for i in image_ids if not self.files.get(i)]
        if missing:
            raise ValidationFailed("参考图片不存在，请重新上传")
        return option, duration

    def create_for_production(
        self, *, production_id: str, account: Account, prompt: str, negative_prompt: str | None,
        dialogue: str | None, image_ids: list[str], resolution: str | None, seed: int | None,
        duration_seconds: int, schedule_mode: str,
    ) -> VideoTask:
        """由生产流程创建视频任务。不提交事务（由调用方与生产状态变更放在同一事务里），
        也不受手动创建的“进行中任务数”配额限制——并发由 Worker 的 generation_max_inflight 控制。"""
        config = load_config(account)
        option, duration = self.validate_params(config, resolution, duration_seconds, image_ids)
        task = VideoTask(
            id=str(uuid.uuid4()), status=TaskStatus.PENDING.value, account_id=account.id, prompt=prompt.strip(),
            negative_prompt=(negative_prompt or "").strip() or None, dialogue=(dialogue or "").strip() or None,
            input_file_ids=image_ids, aspect_ratio=option.aspect_ratio, resolution=option.label,
            duration_seconds=duration, seed=seed if seed is not None else config.seed,
            workflow_key=account.workflow_key, provider_name=self.s.video_provider,
            production_id=production_id, schedule_mode=schedule_mode,
        )
        self.repo.add(task)
        self.repo.add_event(task.id, "task_created", to_status=task.status, message=f"production={production_id}")
        return task

    # ---------- 查询 ----------
    def get(self, task_id: str) -> VideoTask:
        task = self.repo.get(task_id)
        if not task:
            raise NotFoundError("任务不存在", {"task_id": task_id})
        return task

    def list_page(self, **filters) -> VideoListData:
        tasks, total = self.repo.list_page(**filters)
        return VideoListData(
            items=[self._list_item(t) for t in tasks],
            page=filters["page"], page_size=filters["page_size"], total=total,
        )

    def detail(self, task_id: str) -> VideoTaskDetail:
        t = self.get(task_id)
        events = [TaskEventOut(
            event_type=e.event_type, from_status=e.from_status, to_status=e.to_status,
            message=e.message, created_at=e.created_at,
        ) for e in self.repo.list_events(task_id)]
        image_urls = [self.storage.get_url(f.storage_key) for i in (t.input_file_ids or []) if (f := self.files.get(i))]
        return VideoTaskDetail(
            task_id=t.id, status=t.status, prompt=t.prompt, negative_prompt=t.negative_prompt,
            input_image_urls=image_urls, aspect_ratio=t.aspect_ratio, resolution=t.resolution, seed=t.seed,
            duration_seconds=t.duration_seconds, queue_position=self.repo.queue_position(t),
            workflow_key=t.workflow_key, created_at=t.created_at, started_at=t.started_at,
            completed_at=t.completed_at, error_code=t.error_code, error_message=t.error_message,
            retry_count=t.retry_count, can_retry=self._can_retry(t), video_url=self._video_url(t),
            schedule_mode=t.schedule_mode, expected_start_at=self.expected_start_at(t),
            events=events,
        )

    def result(self, task_id: str) -> VideoResult:
        t = self.get(task_id)
        url = self._video_url(t)
        if t.status != TaskStatus.SUCCEEDED.value or not url:
            raise StateConflict("任务尚未成功，没有可用结果", {"status": t.status})
        return VideoResult(
            task_id=t.id, status=t.status, video_url=url, content_type=t.result_content_type,
            size_bytes=t.result_size_bytes, duration_seconds=t.duration_seconds,
        )

    # ---------- 重试 / 取消 ----------
    def retry(self, task_id: str, confirm_duplicate: bool) -> VideoTask:
        t = self.get(task_id)
        if t.status != TaskStatus.FAILED.value:
            raise StateConflict("只有失败的任务可以重试", {"status": t.status})
        if t.error_code in NON_RETRYABLE_ERROR_CODES:
            raise StateConflict("该错误无法通过重试解决，请修正参数或配置", {"error_code": t.error_code})
        if t.retry_count >= self.s.task_max_retries:
            raise StateConflict(f"已达到重试次数上限（{self.s.task_max_retries}）")
        if t.error_code == SUBMIT_UNCERTAIN_CODE and not confirm_duplicate:
            # 外部任务可能已在 GPU 上运行，重试会产生重复费用，必须显式确认
            raise StateConflict(
                "上次提交结果不确定，外部任务可能仍在运行。确认接受重复生成的费用后，带 confirm_duplicate=true 重试",
                {"error_code": t.error_code},
            )
        ok = self.repo.transition(
            t.id, [TaskStatus.FAILED], TaskStatus.PENDING, event_type="retry_requested", is_retry=True,
            values=dict(
                retry_count=t.retry_count + 1, provider_task_id=None, error_code=None, error_message=None,
                started_at=None, completed_at=None, next_poll_at=None, claimed_by=None,
                lease_expires_at=None, submit_retry_count=0,
            ),
        )
        if not ok:
            self.db.rollback()
            raise StateConflict("任务状态已变化，请刷新后重试")
        self.db.commit()
        self.db.refresh(t)
        return t

    def cancel(self, task_id: str) -> CancelResult:
        t = self.get(task_id)
        ok = self.repo.transition(
            t.id, list(ACTIVE_STATUSES), TaskStatus.CANCELLED, event_type="task_cancelled",
            values=dict(completed_at=utcnow(), claimed_by=None, lease_expires_at=None),
        )
        if not ok:
            self.db.rollback()
            raise StateConflict("任务已结束，无法取消", {"status": self.get(task_id).status})
        self.db.commit()
        # 外部 GPU 任务当前没有取消能力：只是本系统不再跟踪，费用可能仍会产生
        started = t.provider_task_id is not None
        return CancelResult(
            task_id=t.id, status=TaskStatus.CANCELLED.value, external_cancelled=False,
            note="已停止跟踪该任务；外部 GPU 任务可能仍在运行" if started else "任务已取消",
        )

    # ---------- 展示辅助 ----------
    def _video_url(self, t: VideoTask) -> str | None:
        if t.status == TaskStatus.SUCCEEDED.value and t.result_storage_key:
            return self.storage.get_url(t.result_storage_key)
        return None

    def _can_retry(self, t: VideoTask) -> bool:
        return (
            t.status == TaskStatus.FAILED.value
            and t.retry_count < self.s.task_max_retries
            and t.error_code not in NON_RETRYABLE_ERROR_CODES
        )

    def expected_start_at(self, t: VideoTask):
        """夜间任务还在等窗口时，预计开始提交的时间；其余情况为 None。"""
        now = utcnow()
        if t.status == TaskStatus.PENDING.value and t.schedule_mode == "window" and not is_window_open(now, self.s):
            return next_window_start(now, self.s)
        return None

    def _list_item(self, t: VideoTask) -> VideoTaskListItem:
        preview = t.prompt if len(t.prompt) <= 40 else t.prompt[:40] + "……"
        return VideoTaskListItem(
            task_id=t.id, status=t.status, prompt_preview=preview, aspect_ratio=t.aspect_ratio,
            resolution=t.resolution, queue_position=self.repo.queue_position(t),
            duration_seconds=t.duration_seconds, created_at=t.created_at, updated_at=t.updated_at,
            video_url=self._video_url(t), error_message=t.error_message,
            schedule_mode=t.schedule_mode, expected_start_at=self.expected_start_at(t),
        )
