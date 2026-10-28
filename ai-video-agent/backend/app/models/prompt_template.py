"""提示词模板（版本化）。

作用域优先级：账号专属 > 视频类型 > 平台通用 > 代码内置默认。
修改模板不会覆盖旧行，而是在同一 group_id 下新增 version，历史产物仍能追溯到当时用的版本。
"""
from datetime import datetime

from sqlalchemy import Boolean, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import utcnow
from app.db.base import Base
from app.db.types import UTCDateTime


class PromptTemplate(Base):
    __tablename__ = "prompt_templates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    group_id: Mapped[str] = mapped_column(String(36))  # 同一模板的所有版本共用
    version: Mapped[int] = mapped_column(Integer, default=1)
    kind: Mapped[str] = mapped_column(String(16))  # scene | dialogue
    name: Mapped[str] = mapped_column(String(64))
    # 作用域，空表示“不限”
    account_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    video_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    platform: Mapped[str | None] = mapped_column(String(32), nullable=True)
    body: Mapped[str] = mapped_column(Text)  # 含 {{变量}}
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    __table_args__ = (Index("ix_prompt_templates_kind_active", "kind", "is_active"),)
