"""SiliconFlow 图生视频 provider（Wan2.2-I2V，异步提交+轮询）。

SiliconFlow 视频接口为异步：submit 拿 requestId -> 轮询 status -> 成功后下载视频 URL。
Wan I2V 产物无音轨（produces_audio=False）。遵循文档 07/10：Key 不入日志、超时、退避。
"""
from __future__ import annotations

import asyncio
from pathlib import Path

import httpx

from app.config import Settings
from app.domain.errors import DomainError, ErrorCode
from app.observability.logging import get_logger
from app.providers.video.base import image_to_data_uri

logger = get_logger(__name__)


class WanVideoProvider:
    name = "wan"
    produces_audio = False

    def __init__(self, settings: Settings):
        if not settings.siliconflow_api_key.strip():
            raise DomainError(ErrorCode.INTERNAL, "SILICONFLOW_API_KEY 未配置，无法使用 wan 图生视频")
        self.model = settings.video_wan_model
        self._api_key = settings.siliconflow_api_key
        self._base_url = settings.siliconflow_base_url.rstrip("/")
        self._poll = settings.video_poll_interval
        self._timeout = settings.video_gen_timeout
        self._img_size = settings.image_size

    async def image_to_video(self, image: Path, prompt: str, *, out_path: Path, seconds: float) -> Path:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        headers = {"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"}
        payload = {
            "model": self.model,
            "prompt": prompt,
            "image": image_to_data_uri(image),
            "image_size": self._img_size,
        }
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            r = await client.post(f"{self._base_url}/video/submit", json=payload, headers=headers)
            if r.status_code >= 400:
                raise DomainError(ErrorCode.INTERNAL, f"wan submit 失败 status={r.status_code}")
            request_id = r.json().get("requestId")
            if not request_id:
                raise DomainError(ErrorCode.MODEL_OUTPUT_INVALID, "wan submit 未返回 requestId")

            url = await self._poll_until_done(client, request_id, headers)
            vid = await client.get(url)
            if vid.status_code >= 400:
                raise DomainError(ErrorCode.INTERNAL, f"下载视频失败 status={vid.status_code}")
            out_path.write_bytes(vid.content)
        logger.info("wan 图生视频成功 model=%s -> %s", self.model, out_path.name)
        return out_path

    async def _poll_until_done(self, client, request_id, headers) -> str:
        waited = 0.0
        while waited < self._timeout:
            s = await client.post(f"{self._base_url}/video/status",
                                  json={"requestId": request_id}, headers=headers)
            data = s.json()
            status = data.get("status")
            if status == "Succeed":
                videos = (data.get("results") or {}).get("videos") or []
                if not videos or not videos[0].get("url"):
                    raise DomainError(ErrorCode.MODEL_OUTPUT_INVALID, "wan 成功但无视频 URL")
                return videos[0]["url"]
            if status == "Failed":
                raise DomainError(ErrorCode.INTERNAL, f"wan 生成失败: {data.get('reason')}")
            await asyncio.sleep(self._poll)
            waited += self._poll
        raise DomainError(ErrorCode.RESOURCE_LIMIT, "wan 图生视频轮询超时")
