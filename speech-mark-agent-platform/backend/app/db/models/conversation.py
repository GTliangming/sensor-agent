"""conversations 表：一次多轮对话（会话）的元信息。

一个用户可有多个会话；会话下挂具体的 Message 与 AgentRun。
"""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Conversation(TimestampMixin, Base):
    """会话。"""

    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(
        String(32), primary_key=True, default=lambda: uuid4().hex
    )
    # 所属用户：建索引便于按用户拉会话列表；用户删除时级联删除其会话
    user_id: Mapped[str] = mapped_column(
        String(32),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    # 会话标题：默认“新会话”，通常由首条消息自动生成
    title: Mapped[str] = mapped_column(
        String(200), nullable=False, default="新会话"
    )
    # 会话状态：active / archived 等
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="active"
    )
    # 最后一条消息时间：用于会话列表按活跃度排序（可空，空表示还没有消息）
    last_message_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )