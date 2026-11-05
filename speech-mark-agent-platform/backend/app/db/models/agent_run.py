"""agent_runs 表：Agent 的一次执行记录（一问一答的完整生命周期）。

记录从入队到完成的状态、输入输出、模型信息与可观测性指标（token、耗时、trace），
用于结果展示、问题排查和用量统计。一次 run 可对应会话里的若干条 Message。
"""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class AgentRun(TimestampMixin, Base):
    """一次 Agent 运行。"""

    __tablename__ = "agent_runs"

    id: Mapped[str] = mapped_column(
        String(32), primary_key=True, default=lambda: uuid4().hex
    )
    # 所属会话：建索引，会话删除时级联删除其运行记录
    conversation_id: Mapped[str] = mapped_column(
        String(32),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    # 发起用户：建索引便于按用户统计，用户删除时级联删除
    user_id: Mapped[str] = mapped_column(
        String(32),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    # 执行状态：queued（默认，入队）→ running → succeeded / failed
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="queued"
    )
    # 用户问题（输入）
    question: Mapped[str] = mapped_column(Text, nullable=False)
    # Agent 回答（输出）；执行中/失败时为空
    answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 失败时的错误码 / 错误信息，便于归因
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 本次使用的模型名与提示词版本，便于复现与 A/B 对比
    model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    prompt_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # 用量指标：输入/输出 token 数，用于计费与统计
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 端到端耗时（毫秒）
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 链路追踪 ID：串联日志与分布式追踪系统
    trace_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # 实际开始 / 结束时间（与 created_at 区分：created_at 是入库时刻）
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    @property
    def thread_id(self) -> str:
        """对外 DTO（RunDTO）用 thread_id 这个名字；底层列其实是 conversation_id。

        RunDTO.model_validate(run) 会按字段名读 thread_id，这里做一层名称适配，
        避免把「thread（对外术语）↔ conversation（存储术语）」的映射散落到各处。
        """
        return self.conversation_id