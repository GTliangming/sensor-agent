"""user_platform_bindings 表：Agent 账号 ↔ Go 标注平台账号 的绑定关系。

一个 Agent 用户至多绑定一个 Go 平台用户（agent_user_id 唯一），
绑定后 Agent 才能以该 Go 身份去调用标注平台的业务接口。
"""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class UserPlatformBinding(TimestampMixin, Base):
    """用户平台绑定记录。"""

    __tablename__ = "user_platform_bindings"

    id: Mapped[str] = mapped_column(
        String(32), primary_key=True, default=lambda: uuid4().hex
    )
    # 被绑定的 Agent 用户：unique 保证一个 Agent 用户只有一条绑定（1:1）
    # 删除用户时级联删除绑定（CASCADE）
    agent_user_id: Mapped[str] = mapped_column(
        String(32),
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    # 对应的 Go 平台用户 ID：唯一 + 索引，防止一个 Go 账号被多个 Agent 用户绑定
    go_user_id: Mapped[str] = mapped_column(
        String(64), unique=True, index=True, nullable=False
    )
    # Go 平台用户名（冗余存一份，便于展示，可空）
    go_username: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # 绑定状态：active / revoked 等
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="active"
    )
    # 操作者：由哪个用户发起绑定（如管理员）；该用户被删时置空（SET NULL）
    bound_by: Mapped[str | None] = mapped_column(
        String(32),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    # 绑定时间
    bound_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )