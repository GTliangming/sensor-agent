"""messages 表：会话中的一条消息（用户提问或 Agent 回答）。

只继承 CreatedAtMixin（有 created_at、无 updated_at）：消息一旦产生即不可变，
修订以追加新消息的方式表达，不原地更新。
"""

from uuid import uuid4

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.db.base import Base, CreatedAtMixin


class Message(CreatedAtMixin, Base):
    """单条消息。"""

    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(
        String(32), primary_key=True, default=lambda: uuid4().hex
    )
    # 所属会话：建索引便于按会话拉取消息；会话删除时级联删除消息
    conversation_id: Mapped[str] = mapped_column(
        String(32),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    # 关联的一次 Agent 执行：可空（用户消息没有 run）；run 被删时置空而非删消息（SET NULL）
    run_id: Mapped[str | None] = mapped_column(
        String(32),
        ForeignKey("agent_runs.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    # 角色：user / assistant / system
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    # 消息正文
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # 正文类型：text / markdown 等，默认纯文本
    content_type: Mapped[str] = mapped_column(
        String(16), nullable=False, default="text"
    )
    # 引用来源（检索片段、文档链接等），以 JSON 存储，可空
    citations_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # 该消息的 token 数，用于统计/计费，可空
    token_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
