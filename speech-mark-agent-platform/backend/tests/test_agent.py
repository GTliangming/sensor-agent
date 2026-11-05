import asyncio
import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.deps import get_llm_client
from app.core.error_catalog import ErrorCode
from app.core.errors import AppError
from app.db.models import AgentRun
from app.integrations.llm.types import LLMResult
from app.main import app


class FakeLLM:
    def __init__(self, content: str = "模拟回答", error: Exception | None = None) -> None:
        self.content = content
        self.error = error
        self.calls: list[list] = []

    async def chat(self, messages, **kwargs) -> LLMResult:
        self.calls.append(list(messages))
        if self.error is not None:
            raise self.error
        return LLMResult(
            content=self.content,
            model="fake-model",
            input_tokens=10,
            output_tokens=5,
            latency_ms=1,
        )


@pytest.fixture
def fake_llm(client):
    fake = FakeLLM()
    app.dependency_overrides[get_llm_client] = lambda: fake
    try:
        yield fake
    finally:
        app.dependency_overrides.pop(get_llm_client, None)


def _login(
    client: TestClient,
    username: str = "tester",
    password: str = "Password123!",
) -> dict[str, str]:
    resp = client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['data']['token']}"}


def _create_thread(
    client: TestClient,
    headers: dict[str, str],
    title: str = "测试会话",
) -> dict:
    resp = client.post(
        "/api/agent/threads",
        json={"title": title},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["data"]


def _latest_run_status(question: str) -> str:
    async def _query() -> str:
        engine = create_async_engine(os.environ["DATABASE_URL"])
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with factory() as session:
            result = await session.execute(
                select(AgentRun).where(AgentRun.question == question)
            )
            run = result.scalar_one()
            status = run.status
        await engine.dispose()
        return status

    return asyncio.run(_query())


def test_agent_requires_auth(client: TestClient) -> None:
    assert client.get("/api/agent/threads").status_code == 401


def test_create_and_list_threads(
    client: TestClient,
    seeded_user: str,
) -> None:
    headers = _login(client)
    thread = _create_thread(client, headers, "项目巡检")

    assert thread["title"] == "项目巡检"
    assert thread["createdAt"]

    listed = client.get("/api/agent/threads", headers=headers)
    assert listed.status_code == 200
    assert any(item["id"] == thread["id"] for item in listed.json()["data"])


def test_messages_start_empty(
    client: TestClient,
    seeded_user: str,
) -> None:
    headers = _login(client)
    thread = _create_thread(client, headers)

    resp = client.get(
        f"/api/agent/threads/{thread['id']}/messages",
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["data"] == []


def test_run_success_persists_messages(
    client: TestClient,
    seeded_user: str,
    fake_llm: FakeLLM,
) -> None:
    headers = _login(client)
    thread = _create_thread(client, headers)

    resp = client.post(
        f"/api/agent/threads/{thread['id']}/runs",
        json={"message": "你好"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text

    run = resp.json()["data"]
    assert run["status"] == "succeeded"
    assert run["answer"] == "模拟回答"

    messages = client.get(
        f"/api/agent/threads/{thread['id']}/messages",
        headers=headers,
    ).json()["data"]
    assert [item["role"] for item in messages] == ["user", "assistant"]
    assert messages[0]["content"] == "你好"
    assert messages[1]["content"] == "模拟回答"

    # 首条上下文是 system prompt
    assert fake_llm.calls[0][0].role == "system"

    detail = client.get(f"/api/agent/runs/{run['id']}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["data"]["status"] == "succeeded"


def test_run_failure_marks_run_failed(
    client: TestClient,
    seeded_user: str,
) -> None:
    fake = FakeLLM(
        error=AppError(
            ErrorCode.LLM_TIMEOUT,
            "模型超时",
            status_code=504,
            retryable=True,
        )
    )
    app.dependency_overrides[get_llm_client] = lambda: fake
    try:
        headers = _login(client)
        thread = _create_thread(client, headers)

        resp = client.post(
            f"/api/agent/threads/{thread['id']}/runs",
            json={"message": "failure-test"},
            headers=headers,
        )
        assert resp.status_code == 504
        assert resp.json()["error"]["code"] == "LLM_TIMEOUT"
        assert _latest_run_status("failure-test") == "failed"
    finally:
        app.dependency_overrides.pop(get_llm_client, None)


def test_cannot_access_other_users_thread(
    client: TestClient,
    seeded_user: str,
    second_user: str,
) -> None:
    owner_headers = _login(client)
    other_headers = _login(client, "other")

    thread = _create_thread(client, owner_headers, "owner-only")

    assert (
        client.get(
            f"/api/agent/threads/{thread['id']}/messages",
            headers=other_headers,
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"/api/agent/threads/{thread['id']}/runs",
            json={"message": "越权"},
            headers=other_headers,
        ).status_code
        == 404
    )

    listed = client.get("/api/agent/threads", headers=other_headers).json()["data"]
    assert all(item["id"] != thread["id"] for item in listed)