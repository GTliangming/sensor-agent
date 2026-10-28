"""Alembic 环境：数据库地址来自 DATABASE_URL，元数据来自 ORM 模型。"""
from alembic import context
from sqlalchemy import create_engine

from app.core.config import get_settings
from app.db.base import Base
from app.db.session import build_engine
import app.models  # noqa: F401  确保所有模型已注册到 Base.metadata

target_metadata = Base.metadata
url = get_settings().database_url


def run_migrations_offline() -> None:
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = build_engine(url)
    with engine.connect() as connection:
        # SQLite 不支持大多数 ALTER，batch 模式会用“建新表+拷贝”方式实现
        context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
