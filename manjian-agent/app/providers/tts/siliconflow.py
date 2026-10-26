"""SiliconFlow TTS provider（CosyVoice2，OpenAI 兼容 /audio/speech）。

遵循文档 08/10：Key 从配置读取、设置超时、429/5xx 有上限退避、日志不输出 Key。
音色/生成内容的商用授权需在接入前核实，不克隆真实人物声音。
"""
from __future__ import annotations

import asyncio
from pathlib import Path

import httpx

from app.config import Settings
from app.domain.errors import DomainError, ErrorCode
from app.observability.logging import get_logger

logger = get_logger(__name__)

_RETRYABLE_STATUS = {429, 500, 502, 503, 504}
_MAX_HTTP_ATTEMPTS = 3


class SiliconFlowTTSProvider:
    name = "siliconflow"
    audio_ext = "mp3"

    def __init__(self, settings: Settings):
        if not settings.siliconflow_api_key.strip():
            raise DomainError(ErrorCode.INTERNAL, "SILICONFLOW_API_KEY 未配置，无法使用 siliconflow TTS provider")
        self.model = settings.tts_model
        self._api_key = settings.siliconflow_api_key
        self._base_url = settings.siliconflow_base_url.rstrip("/")
        self._timeout = settings.tts_timeout_seconds

    async def synthesize(self, text: str, *, out_path: Path, voice: str, speed: float) -> Path:
        payload = {
            "model": self.model,
            "input": text,
            "voice": voice,
            "response_format": self.audio_ext,
            "speed": speed,
        }
        headers = {"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"}
        out_path.parent.mkdir(parents=True, exist_ok=True)
        url = f"{self._base_url}/audio/speech"
        last: Exception | None = None
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            for i in range(1, _MAX_HTTP_ATTEMPTS + 1):
                try:
                    resp = await client.post(url, json=payload, headers=headers)
                except httpx.RequestError as exc:
                    last = exc
                    logger.warning("siliconflow tts request error attempt=%s: %s", i, exc)
                    await asyncio.sleep(min(2 ** i, 8))
                    continue
                if resp.status_code in _RETRYABLE_STATUS:
                    last = DomainError(ErrorCode.PROVIDER_RETRYABLE, f"status {resp.status_code}", retryable=True)
                    logger.warning("siliconflow tts retryable status=%s attempt=%s", resp.status_code, i)
                    await asyncio.sleep(min(2 ** i, 8))
                    continue
                if resp.status_code >= 400:
                    raise DomainError(ErrorCode.INTERNAL, f"siliconflow tts 调用失败 status={resp.status_code}")
                out_path.write_bytes(resp.content)
                logger.info("siliconflow tts 合成成功 model=%s -> %s", self.model, out_path.name)
                return out_path
        raise DomainError(ErrorCode.PROVIDER_RETRYABLE, f"siliconflow tts 多次重试仍失败: {last}", retryable=True)
