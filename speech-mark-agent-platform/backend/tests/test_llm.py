"""DeepSeek 客户端测试：全部使用 MockTransport，不发真实网络请求。"""

import json

import httpx
import pytest

from app.core.errors import AppError
from app.integrations.llm.client import DeepSeekClient
from app.integrations.llm.types import LLMMessage


def _ok_payload(content: str = "pong") -> dict:
    return {
        "model": "deepseek-chat",
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": content,
                }
            }
        ],
        "usage": {
            "prompt_tokens": 12,
            "completion_tokens": 3,
        },
    }


def _client(
    handler,
    *,
    api_key: str = "test-key",
    max_retries: int = 2,
) -> DeepSeekClient:
    return DeepSeekClient(
        api_key=api_key,
        base_url="https://llm.test",
        model="deepseek-chat",
        timeout_seconds=1,
        max_retries=max_retries,
        backoff_seconds=0,
        transport=httpx.MockTransport(handler),
    )


async def test_chat_success() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer test-key"
        body = json.loads(request.content)
        assert body["model"] == "deepseek-chat"
        assert body["messages"] == [{"role": "user", "content": "ping"}]
        assert body["stream"] is False
        return httpx.Response(200, json=_ok_payload("pong"))

    async with _client(handler) as client:
        result = await client.chat([LLMMessage(role="user", content="ping")])

    assert result.content == "pong"
    assert result.model == "deepseek-chat"
    assert result.input_tokens == 12
    assert result.output_tokens == 3
    assert result.latency_ms >= 0


async def test_chat_retries_on_500_then_succeeds() -> None:
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        if calls["count"] == 1:
            return httpx.Response(500, json={"error": {"message": "boom"}})
        return httpx.Response(200, json=_ok_payload())

    async with _client(handler) as client:
        result = await client.chat([LLMMessage(role="user", content="ping")])

    assert result.content == "pong"
    assert calls["count"] == 2


async def test_chat_rate_limited_after_retries() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": {"message": "rate limited"}})

    async with _client(handler, max_retries=1) as client:
        with pytest.raises(AppError) as exc_info:
            await client.chat([LLMMessage(role="user", content="ping")])

    assert exc_info.value.code == "LLM_RATE_LIMITED"
    assert exc_info.value.retryable is True


async def test_chat_timeout() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timeout", request=request)

    async with _client(handler, max_retries=1) as client:
        with pytest.raises(AppError) as exc_info:
            await client.chat([LLMMessage(role="user", content="ping")])

    assert exc_info.value.code == "LLM_TIMEOUT"
    assert exc_info.value.retryable is True


async def test_chat_auth_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": {"message": "unauthorized"}})

    async with _client(handler) as client:
        with pytest.raises(AppError) as exc_info:
            await client.chat([LLMMessage(role="user", content="ping")])

    assert exc_info.value.code == "LLM_NOT_CONFIGURED"


async def test_chat_empty_choices() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": []})

    async with _client(handler) as client:
        with pytest.raises(AppError) as exc_info:
            await client.chat([LLMMessage(role="user", content="ping")])

    assert exc_info.value.code == "LLM_UPSTREAM_ERROR"


async def test_chat_empty_content() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"role": "assistant", "content": ""}}],
            },
        )

    async with _client(handler) as client:
        with pytest.raises(AppError) as exc_info:
            await client.chat([LLMMessage(role="user", content="ping")])

    assert exc_info.value.code == "LLM_UPSTREAM_ERROR"


async def test_chat_without_api_key() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("不应发起网络请求")

    async with _client(handler, api_key="") as client:
        with pytest.raises(AppError) as exc_info:
            await client.chat([LLMMessage(role="user", content="ping")])

    assert exc_info.value.code == "LLM_NOT_CONFIGURED"
