import os
import tempfile
from pathlib import Path

# 必须在导入 app 之前设置，否则 session.py 会绑定到 data/app.db
_tmp_dir = tempfile.mkdtemp(prefix="agent-test-")
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{Path(_tmp_dir) / 'test.db'}"
os.environ["APP_ENV"] = "test"
os.environ["APP_SECRET_KEY"] = "test-secret-key-please-change-0123456789"

import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.security import hash_password
from app.db.models import User, UserPlatformBinding
from app.main import app


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


async def _seed_user(
    *,
    username: str,
    password: str,
    role: str,
    status: str,
    go_user_id: str | None,
) -> str:
    # 用独立 engine，避免和 TestClient 的事件循环串用连接
    engine = create_async_engine(os.environ["DATABASE_URL"])
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with session_factory() as session:
        user = User(
            username=username,
            password_hash=hash_password(password),
            display_name=username,
            role=role,
            status=status,
        )
        session.add(user)
        await session.flush()

        if go_user_id:
            session.add(
                UserPlatformBinding(
                    agent_user_id=user.id,
                    go_user_id=go_user_id,
                    go_username=username,
                    status="active",
                )
            )

        await session.commit()
        user_id = user.id

    await engine.dispose()
    return user_id


@pytest.fixture(scope="session")
def seeded_user(client) -> str:
    # 依赖 client，确保 TestClient 的 lifespan 已经执行过 init_db
    return asyncio.run(
        _seed_user(
            username="tester",
            password="Password123!",
            role="admin",
            status="active",
            go_user_id="10001",
        )
    )


@pytest.fixture(scope="session")
def disabled_user(client) -> str:
    return asyncio.run(
        _seed_user(
            username="disabled",
            password="Password123!",
            role="annotator",
            status="disabled",
            go_user_id=None,
        )
    )
