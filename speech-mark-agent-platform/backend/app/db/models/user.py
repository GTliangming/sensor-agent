"""users 表：Agent 平台自有的账号体系（登录、鉴权、角色）。

与 Go 标注平台的账号相互独立；两者的对应关系记录在 UserPlatformBinding。
"""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class User(TimestampMixin, Base):
    """平台用户。继承 TimestampMixin 自带 created_at / updated_at。"""

    __tablename__ = "users"

    # 主键用 32 位十六进制 UUID（uuid4().hex），应用层生成、无业务含义
    id: Mapped[str] = mapped_column(
        String(32), primary_key=True, default=lambda: uuid4().hex
    )
    # 登录名：唯一且建索引，用于登录查询
    username: Mapped[str] = mapped_column(
        String(64), unique=True, index=True, nullable=False
    )
    # 密码哈希：只存散列值，绝不存明文
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    # 展示名：可为空串，默认用 username 由上层兜底
    display_name: Mapped[str] = mapped_column(
        String(64), nullable=False, default=""
    )
    # 角色：权限控制用，默认标注员 annotator（如 admin / annotator）
    role: Mapped[str] = mapped_column(
        String(32), nullable=False, default="annotator"
    )
    # 账号状态：active / disabled 等，用于封禁而非物理删除
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="active"
    )
    # 最近登录时间：可空（从未登录为 NULL）
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )