"""视频任务数据访问。所有“带条件的状态更新”都集中在这里，业务层不写 SQL。"""
from collections.abc import Iterable
from datetime import datetime, timedelta

from sqlalchemy import and_, false, func, or_, select, true, update
from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.domain.status import ACTIVE_STATUSES, TaskStatus, can_transition
from app.models import VideoTask, VideoTaskAttempt, VideoTaskEvent


class VideoTaskRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    # ---------- 基础读写 ----------
    def add(self, task: VideoTask) -> None:
        self.db.add(task)
        self.db.flush()

    def get(self, task_id: str) -> VideoTask | None:
        return self.db.get(VideoTask, task_id)

    def get_by_idempotency_key(self, key: str) -> VideoTask | None:
        return self.db.scalar(select(VideoTask).where(VideoTask.idempotency_key == key))

    def count_active(self) -> int:
        stmt = select(func.count()).select_from(VideoTask).where(
            VideoTask.status.in_([s.value for s in ACTIVE_STATUSES])
        )
        return self.db.scalar(stmt) or 0

    def list_page(
        self,
        *,
        page: int,
        page_size: int,
        status: str | None = None,
        created_after: datetime | None = None,
        created_before: datetime | None = None,
    ) -> tuple[list[VideoTask], int]:
        conds = []
        if status:
            conds.append(VideoTask.status == status)
        if created_after:
            conds.append(VideoTask.created_at >= created_after)
        if created_before:
            conds.append(VideoTask.created_at <= created_before)
        total = self.db.scalar(select(func.count()).select_from(VideoTask).where(*conds)) or 0
        stmt = (
            select(VideoTask).where(*conds)
            .order_by(VideoTask.created_at.desc(), VideoTask.id)
            .offset((page - 1) * page_size).limit(page_size)
        )
        return list(self.db.scalars(stmt)), total

    # ---------- 事件 ----------
    def add_event(
        self, task_id: str, event_type: str, *, from_status: str | None = None,
        to_status: str | None = None, message: str | None = None,
    ) -> None:
        self.db.add(VideoTaskEvent(
            task_id=task_id, event_type=event_type, from_status=from_status,
            to_status=to_status, message=message,
        ))

    def list_events(self, task_id: str) -> list[VideoTaskEvent]:
        stmt = select(VideoTaskEvent).where(VideoTaskEvent.task_id == task_id).order_by(VideoTaskEvent.id)
        return list(self.db.scalars(stmt))

    # ---------- 状态流转（带条件更新，防止旧结果覆盖新状态） ----------
    def transition(
        self, task_id: str, from_statuses: Iterable[TaskStatus], to_status: TaskStatus, *,
        event_type: str, message: str | None = None, values: dict | None = None,
        is_retry: bool = False,
    ) -> bool:
        """原子地把任务从 from_statuses 之一改为 to_status。

        使用 `UPDATE ... WHERE id=? AND status=?`，数据库保证只有一方成功；
        返回 False 表示任务状态已被别人改过（例如已被取消），调用方应放弃本次结果。
        """
        for src in from_statuses:
            if not can_transition(src, to_status, is_retry=is_retry):
                continue
            result = self.db.execute(
                update(VideoTask)
                .where(VideoTask.id == task_id, VideoTask.status == src.value)
                .values(status=to_status.value, updated_at=utcnow(), **(values or {}))
            )
            if result.rowcount == 1:
                self.add_event(task_id, event_type, from_status=src.value,
                               to_status=to_status.value, message=message)
                return True
        return False

    def update_fields(self, task_id: str, values: dict) -> None:
        """不改变状态的字段更新。"""
        self.db.execute(
            update(VideoTask).where(VideoTask.id == task_id).values(updated_at=utcnow(), **values)
        )

    # ---------- Worker 租约 ----------
    def queue_position(self, task: VideoTask) -> int | None:
        """还没提交到 GPU 的任务在队列里的顺序（从 1 开始），按创建时间先到先得。"""
        if task.status != TaskStatus.PENDING.value:
            return None
        ahead = self.db.scalar(select(func.count()).select_from(VideoTask).where(
            VideoTask.status == TaskStatus.PENDING.value, VideoTask.created_at < task.created_at)) or 0
        return ahead + 1

    def count_inflight(self) -> int:
        """占用 GPU 并发名额的任务数：已提交/运行中，加上此刻正被 Worker 持有租约、即将提交的 pending 任务。

        后者避免多个 Worker 几乎同时看到“还有空位”而一起提交，超出并发上限。
        """
        now = utcnow()
        submitted = VideoTask.status.in_([TaskStatus.SUBMITTED.value, TaskStatus.RUNNING.value])
        submitting = and_(
            VideoTask.status == TaskStatus.PENDING.value,
            VideoTask.claimed_by.is_not(None), VideoTask.lease_expires_at >= now,
        )
        return self.db.scalar(select(func.count()).select_from(VideoTask).where(or_(submitted, submitting))) or 0

    def claim_next(
        self, worker_id: str, lease_seconds: int, *, include_pending: bool = True, window_open: bool = True,
    ) -> VideoTask | None:
        """原子领取一个可处理的任务。

        只用条件 UPDATE（不依赖 SKIP LOCKED），SQLite 与 PostgreSQL 行为一致：
        多个 Worker 同时抢同一行时，只有一个 rowcount==1。

        include_pending=False：并发已满，只继续轮询已提交的任务，不再提交新任务。
        window_open=False：夜间窗口关闭，schedule_mode='window' 的新任务不提交；
        已提交的任务不受窗口影响（必须继续轮询才能拿到结果）。
        """
        now = utcnow()
        free = or_(VideoTask.claimed_by.is_(None), VideoTask.lease_expires_at < now)
        due = or_(VideoTask.next_poll_at.is_(None), VideoTask.next_poll_at <= now)
        pending = TaskStatus.PENDING.value
        if include_pending:
            pending_ok = and_(
                VideoTask.status == pending,
                or_(VideoTask.schedule_mode == "now", true() if window_open else false()),
            )
        else:
            pending_ok = false()
        eligible = or_(VideoTask.status != pending, pending_ok)
        active = [s.value for s in ACTIVE_STATUSES]
        stmt = (
            select(VideoTask.id, VideoTask.status)
            .where(VideoTask.status.in_(active), free, due, eligible)
            .order_by(VideoTask.created_at).limit(5)
        )
        for task_id, seen_status in self.db.execute(stmt).all():
            result = self.db.execute(
                update(VideoTask)
                .where(VideoTask.id == task_id, VideoTask.status == seen_status, free, due, eligible)
                .values(claimed_by=worker_id, lease_expires_at=now + timedelta(seconds=lease_seconds))
            )
            if result.rowcount == 1:
                self.db.commit()
                self.db.expire_all()
                return self.get(task_id)
            self.db.rollback()
        return None

    def extend_lease(self, task_id: str, worker_id: str, lease_seconds: int) -> None:
        self.db.execute(
            update(VideoTask)
            .where(VideoTask.id == task_id, VideoTask.claimed_by == worker_id)
            .values(lease_expires_at=utcnow() + timedelta(seconds=lease_seconds))
        )

    def release(self, task_id: str, worker_id: str, next_poll_at: datetime | None) -> None:
        """释放租约并设置下次处理时间。只有持有者能释放。"""
        self.db.execute(
            update(VideoTask)
            .where(VideoTask.id == task_id, VideoTask.claimed_by == worker_id)
            .values(claimed_by=None, lease_expires_at=None, next_poll_at=next_poll_at)
        )

    # ---------- 执行记录 ----------
    def create_attempt(self, task_id: str, request_token: str) -> VideoTaskAttempt:
        n = (self.db.scalar(
            select(func.max(VideoTaskAttempt.attempt_number)).where(VideoTaskAttempt.task_id == task_id)
        ) or 0) + 1
        attempt = VideoTaskAttempt(task_id=task_id, attempt_number=n, request_token=request_token)
        self.db.add(attempt)
        self.db.flush()
        return attempt

    def latest_attempt(self, task_id: str) -> VideoTaskAttempt | None:
        stmt = (select(VideoTaskAttempt).where(VideoTaskAttempt.task_id == task_id)
                .order_by(VideoTaskAttempt.attempt_number.desc()).limit(1))
        return self.db.scalar(stmt)
