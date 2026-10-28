"""生产流程相关表：生产主表、阶段产物（带版本）、审核记录。"""
from datetime import datetime

from sqlalchemy import JSON, BigInteger, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import utcnow
from app.db.base import Base
from app.db.types import UTCDateTime
from app.domain.production_status import ProductionStatus


class Production(Base):
    __tablename__ = "productions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    account_id: Mapped[str] = mapped_column(String(36), ForeignKey("accounts.id"))
    # 主题：用户输入，或留空由 LLM 自动选择（生成后回填 LLM 给出的主题）
    topic: Mapped[str] = mapped_column(Text, default="")
    video_type: Mapped[str] = mapped_column(String(32), default="general")
    # night：等夜间窗口再提交 AutoDL；now：审核通过后立即提交
    run_mode: Mapped[str] = mapped_column(String(8), default="night")
    status: Mapped[str] = mapped_column(String(24), default=ProductionStatus.SCENE_GENERATING.value)

    # ---- 生成参数（创建时确定，之后随视频任务一起提交） ----
    duration_seconds: Mapped[int] = mapped_column(Integer, default=15, server_default="15")
    resolution: Mapped[str] = mapped_column(String(32), default="480p竖", server_default="480p竖")
    seed: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    reference_file_ids: Mapped[list] = mapped_column(JSON, default=list)

    failed_stage: Mapped[str | None] = mapped_column(String(16), nullable=True)  # content|video
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 用户“重新生成”时填写的修改意见，下一次 LLM 调用会带上，用完清空
    pending_feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 当前对应的视频任务；重新生成视频会创建新任务并指向它
    video_task_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    # LLM 阶段的 Worker 租约（与视频任务相同的并发保护方式）
    claimed_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (
        Index("ix_productions_status", "status"),
        Index("ix_productions_created_at", "created_at"),
    )


class ProductionArtifact(Base):
    """阶段产物。每次 LLM 生成或人工修改都新增一个版本，不覆盖。"""

    __tablename__ = "production_artifacts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    production_id: Mapped[str] = mapped_column(String(36), ForeignKey("productions.id"))
    kind: Mapped[str] = mapped_column(String(16))  # content（LLM 一次生成的完整业务数据）
    version: Mapped[int] = mapped_column(Integer)
    # content: {"theme","tts_text","subtitles":[{start,end,text}],"scenes":[{scene_id,scene_desc,action_desc,camera_desc}]}
    content: Mapped[dict] = mapped_column(JSON)
    source: Mapped[str] = mapped_column(String(8))  # llm | human
    template_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    rendered_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)  # 实际发给 LLM 的内容，便于排查
    feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    __table_args__ = (UniqueConstraint("production_id", "kind", "version", name="uq_artifact_version"),)


class ProductionReview(Base):
    """人工审核/操作记录。"""

    __tablename__ = "production_reviews"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    production_id: Mapped[str] = mapped_column(String(36), ForeignKey("productions.id"))
    stage: Mapped[str] = mapped_column(String(16))  # scene | dialogue | video | production
    action: Mapped[str] = mapped_column(String(24))
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    artifact_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    __table_args__ = (Index("ix_production_reviews_production", "production_id", "id"),)
