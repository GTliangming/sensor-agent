"""DeepSeek（OpenAI 兼容接口）。JSON 模式要求提示词里出现 “JSON” 字样，节点的 system 提示已包含。"""
import json

import httpx

from app.core.config import Settings
from app.core.logging import redact
from app.llm.base import LLMError


class DeepSeekClient:
    name = "deepseek"

    def __init__(self, s: Settings) -> None:
        self.s = s

    async def chat_json(self, system: str, user: str) -> dict:
        if not self.s.deepseek_api_key:
            raise LLMError("LLM_NOT_CONFIGURED", "未配置 DEEPSEEK_API_KEY")
        body = {
            "model": self.s.deepseek_model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "response_format": {"type": "json_object"},
            "temperature": 0.8,
            "max_tokens": 2000,
        }
        try:
            async with httpx.AsyncClient(
                base_url=self.s.deepseek_base_url, timeout=self.s.llm_timeout_seconds,
                headers={"Authorization": f"Bearer {self.s.deepseek_api_key}"},
            ) as c:
                resp = await c.post("/chat/completions", json=body)
        except httpx.HTTPError as e:
            raise LLMError("LLM_UNREACHABLE", f"调用 DeepSeek 失败: {type(e).__name__}", retryable=True) from e

        if resp.status_code in (401, 403):
            raise LLMError("LLM_AUTH_FAILED", "DeepSeek 认证失败，请检查 API Key")
        if resp.status_code == 402:
            raise LLMError("LLM_INSUFFICIENT_BALANCE", "DeepSeek 余额不足")
        if resp.status_code == 429 or resp.status_code >= 500:
            raise LLMError("LLM_UNAVAILABLE", f"DeepSeek 暂不可用 HTTP {resp.status_code}", retryable=True)
        if resp.status_code >= 400:
            raise LLMError("LLM_BAD_REQUEST", redact(f"HTTP {resp.status_code}: {resp.text[:200]}", [self.s.deepseek_api_key]))
        try:
            content = resp.json()["choices"][0]["message"]["content"]
            return json.loads(content)
        except (KeyError, IndexError, ValueError, TypeError) as e:
            # JSON 模式偶尔会返回空内容或被截断，重试通常能恢复
            raise LLMError("LLM_BAD_OUTPUT", "模型返回内容不是合法 JSON", retryable=True) from e
