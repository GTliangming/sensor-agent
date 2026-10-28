"""视频任务主表。

数据库是任务状态的唯一事实来源；Redis/内存都只是加速手段。
"""
from datetime import datetime

from sqlalchemy import JSON, BigInteger, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import utcnow
from app.db.base import Base
from app.db.types import UTCDateTime
from app.domain.status import TaskStatus


class VideoTask(Base):
    __tablename__ = "video_tasks"

    # 公开任务标识，使用 UUID 字符串（不暴露自增 ID）
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    status: Mapped[str] = mapped_column(String(16), default=TaskStatus.PENDING.value)

    # ---- 用户输入 ----
    prompt: Mapped[str] = mapped_column(Text)
    negative_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 参考图片（上传文件 ID 列表，最多 8 张，可为空）
    input_file_ids: Mapped[list] = mapped_column(JSON, default=list)
    aspect_ratio: Mapped[str] = mapped_column(String(16), default="9:16")
    # 视频方向的选项标签（如 480p竖），原样传给 AutoDL 工作流
    resolution: Mapped[str | None] = mapped_column(String(32), nullable=True)
    duration_seconds: Mapped[int] = mapped_column(Integer, default=12)
    # 工作流 seed：每次任务记录实际使用的值，便于复现
    seed: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # 台词：随任务提交给 AutoDL（接口本身支持带台词生成）
    dialogue: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ---- 所属生产流程与调度 ----
    # 所属账号类型：生成时据此从数据库取工作流 ID、请求字段名等配置
    account_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    production_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # now：随时可提交；window：只在夜间窗口内提交（已提交的任务不受影响）
    schedule_mode: Mapped[str] = mapped_column(String(8), default="now", server_default="now")

    # ---- 执行配置 ----
    workflow_key: Mapped[str] = mapped_column(String(64))
    workflow_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    provider_name: Mapped[str] = mapped_column(String(32))
    provider_task_id: Mapped[str | None] = mapped_column(String(128), nullable=True)

    # ---- 结果 ----
    result_storage_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    result_content_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    result_size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    # ---- 错误 ----
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)  # 已脱敏
    retry_count: Mapped[int] = mapped_column(Integer, default=0)

    # ---- 幂等 ----
    # 客户端通过 Idempotency-Key 头传入；唯一索引保证重复提交只产生一个任务
    idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True, unique=True)

    # ---- Worker 租约（并发保护） ----
    claimed_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    # 下一次允许处理的时间：用于轮询间隔与退避；None 表示立即可处理
    next_poll_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    submit_retry_count: Mapped[int] = mapped_column(Integer, default=0)

    # ---- 时间 ----
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    __table_args__ = (
        Index("ix_video_tasks_status", "status"),
        Index("ix_video_tasks_created_at", "created_at"),
        Index("ix_video_tasks_provider_task_id", "provider_task_id"),
    )
