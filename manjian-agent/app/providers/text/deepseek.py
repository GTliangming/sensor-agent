"""DeepSeek 文本 provider（OpenAI 兼容，httpx 直连）。

遵循文档 01/07/10：密钥从配置读取、设置超时、对 429/5xx 有上限退避、
日志禁止输出 API Key。使用 response_format=json_object 提升 JSON 合法率。
"""
from __future__ import annotations

import asyncio
import json
import re

import httpx

from app.config import Settings
from app.domain.errors import DomainError, ErrorCode
from app.domain.request import CreateTaskRequest
from app.observability.logging import get_logger
from app.providers.text.base import build_storyboard_prompt

logger = get_logger(__name__)

_RETRYABLE_STATUS = {429, 500, 502, 503, 504}
_MAX_HTTP_ATTEMPTS = 3


def _loads_lenient(content: str) -> dict:
    """容错解析模型 JSON：去掉 markdown 代码围栏、截取首尾大括号、去尾随逗号后再解析。

    DeepSeek 偶发返回带 ```json 围栏或尾随逗号的内容，直接 json.loads 会失败。
    """
    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text).strip()
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end != -1 and end > start:
        text = text[start:end + 1]
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # 去掉对象/数组结尾的尾随逗号再试一次
        repaired = re.sub(r",(\s*[}\]])", r"\1", text)
        return json.loads(repaired)


class DeepSeekTextProvider:
    name = "deepseek"

    def __init__(self, settings: Settings):
        if not settings.deepseek_api_key.strip():
            raise DomainError(ErrorCode.INTERNAL, "DEEPSEEK_API_KEY 未配置，无法使用 deepseek provider")
        self._api_key = settings.deepseek_api_key
        self._base_url = settings.deepseek_base_url.rstrip("/")
        self._model = settings.deepseek_model
        self._timeout = settings.http_timeout_seconds

    async def generate_storyboard(self, request: CreateTaskRequest, *, attempt: int = 1) -> dict:
        system, user = build_storyboard_prompt(request)
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "response_format": {"type": "json_object"},
            # 结构化输出用较低温度，显著降低偶发的非法 JSON（缺逗号/多逗号）
            "temperature": 0.3,
        }
        content = await self._post_chat(payload)
        try:
            return _loads_lenient(content)
        except (json.JSONDecodeError, ValueError) as exc:
            raise DomainError(
                ErrorCode.MODEL_OUTPUT_INVALID,
                f"DeepSeek 返回的不是合法 JSON: {exc}",
            ) from exc

    async def _post_chat(self, payload: dict) -> str:
        url = f"{self._base_url}/chat/completions"
        headers = {"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"}
        last_exc: Exception | None = None
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            for i in range(1, _MAX_HTTP_ATTEMPTS + 1):
                try:
                    resp = await client.post(url, json=payload, headers=headers)
                except httpx.RequestError as exc:
                    last_exc = exc
                    logger.warning("deepseek request error attempt=%s: %s", i, exc)
                    await self._backoff(i)
                    continue

                if resp.status_code in _RETRYABLE_STATUS:
                    logger.warning("deepseek retryable status=%s attempt=%s", resp.status_code, i)
                    last_exc = DomainError(
                        ErrorCode.PROVIDER_RETRYABLE,
                        f"deepseek status {resp.status_code}",
                        retryable=True,
                    )
                    await self._backoff(i)
                    continue

                if resp.status_code >= 400:
                    raise DomainError(
                        ErrorCode.INTERNAL,
                        f"deepseek 调用失败 status={resp.status_code}",
                    )

                data = resp.json()
                return data["choices"][0]["message"]["content"]

        raise DomainError(
            ErrorCode.PROVIDER_RETRYABLE,
            f"deepseek 多次重试仍失败: {last_exc}",
            retryable=True,
        )

    @staticmethod
    async def _backoff(attempt: int) -> None:
        await asyncio.sleep(min(2 ** attempt, 8))
