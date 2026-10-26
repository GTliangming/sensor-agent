"""SiliconFlow 图像 provider（Qwen/Qwen-Image，OpenAI 兼容）。

遵循文档 07：API Key 从配置读取、设置超时、对 429/5xx 有上限退避、
成功后由上层校验图片格式/尺寸/大小、日志禁止输出 API Key 或签名 URL。
"""
from __future__ import annotations

import asyncio
import base64
from pathlib import Path

import httpx

from app.config import Settings
from app.domain.errors import DomainError, ErrorCode
from app.observability.logging import get_logger

logger = get_logger(__name__)

_RETRYABLE_STATUS = {429, 500, 502, 503, 504}
_MAX_HTTP_ATTEMPTS = 3


class SiliconFlowImageProvider:
    name = "siliconflow"

    def __init__(self, settings: Settings):
        if not settings.siliconflow_api_key.strip():
            raise DomainError(ErrorCode.INTERNAL, "SILICONFLOW_API_KEY 未配置，无法使用 siliconflow 图像 provider")
        self.model = settings.image_model
        self._api_key = settings.siliconflow_api_key
        self._base_url = settings.siliconflow_base_url.rstrip("/")
        self._steps = settings.image_num_inference_steps
        self._timeout = settings.image_timeout_seconds

    async def generate(
        self, prompt: str, *, width: int, height: int, idempotency_key: str, out_path: Path
    ) -> Path:
        payload = {
            "model": self.model,
            "prompt": prompt,
            "image_size": f"{width}x{height}",
            "batch_size": 1,
            "num_inference_steps": self._steps,
        }
        headers = {"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"}
        out_path.parent.mkdir(parents=True, exist_ok=True)

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            data = await self._post_json(client, f"{self._base_url}/images/generations", payload, headers)
            image_bytes = await self._extract_image(client, data)
            out_path.write_bytes(image_bytes)
        logger.info("siliconflow image 生成成功 model=%s -> %s", self.model, out_path.name)
        return out_path

    async def _post_json(self, client, url, payload, headers) -> dict:
        last: Exception | None = None
        for i in range(1, _MAX_HTTP_ATTEMPTS + 1):
            try:
                resp = await client.post(url, json=payload, headers=headers)
            except httpx.RequestError as exc:
                last = exc
                logger.warning("siliconflow image request error attempt=%s: %s", i, exc)
                await asyncio.sleep(min(2 ** i, 8))
                continue
            if resp.status_code in _RETRYABLE_STATUS:
                last = DomainError(ErrorCode.PROVIDER_RETRYABLE, f"status {resp.status_code}", retryable=True)
                logger.warning("siliconflow image retryable status=%s attempt=%s", resp.status_code, i)
                await asyncio.sleep(min(2 ** i, 8))
                continue
            if resp.status_code >= 400:
                raise DomainError(ErrorCode.INTERNAL, f"siliconflow image 调用失败 status={resp.status_code}")
            return resp.json()
        raise DomainError(ErrorCode.PROVIDER_RETRYABLE, f"siliconflow image 多次重试仍失败: {last}", retryable=True)

    async def _extract_image(self, client, data: dict) -> bytes:
        images = data.get("images") or data.get("data") or []
        if not images:
            raise DomainError(ErrorCode.MODEL_OUTPUT_INVALID, "siliconflow image 返回为空")
        first = images[0]
        if isinstance(first, dict) and first.get("url"):
            r = await client.get(first["url"])
            if r.status_code >= 400:
                raise DomainError(ErrorCode.INTERNAL, f"下载生成图片失败 status={r.status_code}")
            return r.content
        b64 = first.get("b64_json") if isinstance(first, dict) else None
        if b64:
            return base64.b64decode(b64)
        raise DomainError(ErrorCode.MODEL_OUTPUT_INVALID, "siliconflow image 返回缺少 url / b64_json")
