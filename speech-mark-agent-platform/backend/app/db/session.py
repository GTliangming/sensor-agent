"""异步数据库会话基础设施：集中管理引擎、会话工厂与请求级 session。

全应用共用一个 engine（内含连接池），每个请求通过 `get_db` 依赖拿到独立的
AsyncSession，用完自动关闭、出错自动回滚。新增模型/仓储时直接复用这里，
不要在各处自行 create_async_engine，避免连接池失控。
"""

from collections.abc import AsyncIterator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings

settings = get_settings()

# 异步数据库引擎：进程内单例，内部维护连接池，供所有请求共享。
# - database_url 用异步驱动（如 sqlite+aiosqlite / postgresql+asyncpg）
# - echo=False：不打印每条 SQL；本地排查时可临时置 True
# - future=True：启用 SQLAlchemy 2.0 风格 API
engine = create_async_engine(
    settings.database_url,
    echo=False,
    future=True,
)

# 会话工厂：调用 SessionLocal() 产出一个 AsyncSession。
# - class_=AsyncSession：生成异步会话
# - expire_on_commit=False：commit 后对象属性不过期，避免提交后再访问字段
#   触发额外的隐式查询（异步下尤其容易踩坑）
SessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


# 监听底层连接的 connect 事件：每建立一条物理连接就执行一次。
# 挂在 sync_engine 上是因为连接事件发生在同步的 DBAPI 层。
@event.listens_for(engine.sync_engine, "connect")
def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
    """SQLite 默认关闭外键，必须显式打开，否则 ondelete 等约束不生效。"""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI 依赖：每个请求一个独立 session，出异常自动回滚。

    用法：`db: AsyncSession = Depends(get_db)`。
    - async with 保证请求结束后 session 一定被关闭（归还连接池）
    - 捕获异常先 rollback 再 raise，避免把脏事务状态带到下一次使用
    - 这里只负责回滚，不做 commit；提交时机交给业务代码显式控制
    """
    async with SessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise