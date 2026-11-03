from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """所有 ORM 模型的声明式基类。

    SQLAlchemy 2.0 通过继承 DeclarativeBase 来收集表结构元数据
    （Base.metadata），建表、迁移时都以它为入口。
    业务模型统一继承本类，例如 `class User(Base): ...`。
    """

    pass


class CreatedAtMixin:
    """提供「创建时间」字段的 Mixin，供需要记录创建时刻的模型复用。"""

    # created_at：记录行的创建时间。
    # - 必须用 `名称: Mapped[类型]` 的注解写法，SQLAlchemy 2.0 据此推断列类型
    # - DateTime(timezone=True)：存带时区的时间戳
    # - server_default=func.now()：由数据库在 INSERT 时填充当前时间（而非应用层）
    # - nullable=False：非空约束
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class TimestampMixin(CreatedAtMixin):
    """在 created_at 之上再加「更新时间」，适合需要完整时间戳的模型。"""

    # updated_at：记录行的最近更新时间。
    # - server_default=func.now()：首次 INSERT 时也会有初始值
    # - onupdate=func.now()：每次 UPDATE 时自动刷新为当前时间
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
