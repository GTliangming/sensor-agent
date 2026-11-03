from app.db import models  # noqa: F401  注册所有模型
from app.db.base import Base
from app.db.session import engine


async def init_db() -> None:
    """V0.1 直接 create_all；表结构稳定后再引入 Alembic。"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)