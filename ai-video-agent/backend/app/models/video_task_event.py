"""任务事件表与执行记录表。"""
from datetime import datetime

from sqlalchemy import ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import utcnow
from app.db.base import Base
from app.db.types import UTCDateTime


class VideoTaskEvent(Base):
    """状态变化与关键动作的追加式日志，用于排查“失败发生在哪个环节”。"""

    __tablename__ = "video_task_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("video_tasks.id"))
    from_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    to_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    event_type: Mapped[str] = mapped_column(String(64))
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    __table_args__ = (Index("ix_video_task_events_task_id", "task_id", "id"),)


class VideoTaskAttempt(Base):
    """每次向外部服务提交算一次 attempt，重试不会覆盖历史。

    request_token 在提交前就落库：即使提交后进程崩溃、没来得及保存
    provider_task_id，也能知道“曾经尝试过提交”，避免盲目重复提交。
    """

    __tablename__ = "video_task_attempts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("video_tasks.id"))
    attempt_number: Mapped[int] = mapped_column(Integer)
    request_token: Mapped[str] = mapped_column(String(36))
    provider_task_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # started -> submitted -> succeeded | failed
    status: Mapped[str] = mapped_column(String(16), default="started")
    started_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (Index("ix_video_task_attempts_task_id", "task_id", "attempt_number"),)
