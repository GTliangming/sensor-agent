"""业务线与账号类型。

数据层级：业务线（如视频号）-> 账号类型（如女性向情感治愈类）-> 提示词模板 / 生产任务。
一种账号类型对应一套人设与提示词模板；新增类型只是新增一条记录和一组模板，不改代码。
"""
from datetime import datetime

from sqlalchemy import JSON, Boolean, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import utcnow
from app.db.base import Base
from app.db.types import UTCDateTime


class BusinessLine(Base):
    """业务线（发布平台）。key 同时被 accounts.platform 引用。"""

    __tablename__ = "business_lines"

    key: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(64))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Account(Base):
    """账号类型（沿用 accounts 表名）。"""

    __tablename__ = "accounts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    slug: Mapped[str] = mapped_column(String(32))  # 稳定标识，如 female_healing
    name: Mapped[str] = mapped_column(String(64))
    platform: Mapped[str] = mapped_column(String(32))  # 所属业务线 business_lines.key
    # 人设/语气，用于主题建议等需要“账号气质”的提示词
    persona: Mapped[str] = mapped_column(Text)
    style_guide: Mapped[str | None] = mapped_column(Text, nullable=True)
    workflow_key: Mapped[str] = mapped_column(String(64))
    # 该类型的生成参数默认值，后续可在后台修改：{"seed": 683072603085674, "video_config": {...}}
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (UniqueConstraint("platform", "slug", name="uq_account_platform_slug"),)
