"""数据库引擎与会话。仅通过 DATABASE_URL 区分 SQLite / PostgreSQL。"""
from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings


def build_engine(database_url: str) -> Engine:
    url = make_url(database_url)
    if url.get_backend_name() == "sqlite":
        # 文件库时确保目录存在，避免首次启动报 unable to open database file
        if url.database and url.database != ":memory:":
            Path(url.database).parent.mkdir(parents=True, exist_ok=True)
        engine = create_engine(
            database_url,
            # API 线程与 Worker 线程会共用同一个库文件
            connect_args={"check_same_thread": False, "timeout": 30},
        )

        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(dbapi_conn, _):  # noqa: ANN001
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA journal_mode=WAL")  # 读写并发更友好
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()

        return engine
    # 服务端数据库：连接池 + 断线探测
    return create_engine(database_url, pool_pre_ping=True, pool_size=10, max_overflow=10)


engine = build_engine(get_settings().database_url)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)


def get_db() -> Iterator[Session]:
    """FastAPI 依赖：一个请求一个会话，结束时关闭。事务由 service 层显式 commit。"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
