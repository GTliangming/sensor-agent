"""MiniMax 图生视频 provider（海螺 H3 / Hailuo，异步任务）。

流程：video_generation 提交拿 task_id -> 轮询 query 直到 Success 拿 file_id -> files/retrieve 拿下载链接。
海螺 H3 自带立体声音轨（produces_audio=True）；Hailuo 2.3 等默认无音轨。
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


class MiniMaxVideoProvider:
    name = "minimax"

    def __init__(self, settings: Settings):
        if not settings.minimax_api_key.strip():
            raise DomainError(ErrorCode.INTERNAL, "MINIMAX_API_KEY 未配置，无法使用 minimax 图生视频")
        self.model = settings.video_minimax_model
        self.produces_audio = "h3" in self.model.lower()
        self._api_key = settings.minimax_api_key
        self._base_url = settings.minimax_base_url.rstrip("/")
        self._poll = settings.video_poll_interval
        self._timeout = settings.video_gen_timeout

    async def image_to_video(self, image: Path, prompt: str, *, out_path: Path, seconds: float) -> Path:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        headers = {"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"}
        payload = {"model": self.model, "prompt": prompt, "first_frame_image": image_to_data_uri(image)}
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            r = await client.post(f"{self._base_url}/video_generation", json=payload, headers=headers)
            if r.status_code >= 400:
                raise DomainError(ErrorCode.INTERNAL, f"minimax submit 失败 status={r.status_code}")
            task_id = r.json().get("task_id")
            if not task_id:
                raise DomainError(ErrorCode.MODEL_OUTPUT_INVALID, "minimax 未返回 task_id")

            file_id = await self._poll_until_done(client, task_id, headers)
            meta = await client.get(f"{self._base_url}/files/retrieve",
                                    params={"file_id": file_id}, headers=headers)
            dl = ((meta.json() or {}).get("file") or {}).get("download_url")
            if not dl:
                raise DomainError(ErrorCode.MODEL_OUTPUT_INVALID, "minimax 未返回 download_url")
            vid = await client.get(dl)
            if vid.status_code >= 400:
                raise DomainError(ErrorCode.INTERNAL, f"下载视频失败 status={vid.status_code}")
            out_path.write_bytes(vid.content)
        logger.info("minimax 图生视频成功 model=%s -> %s", self.model, out_path.name)
        return out_path

    async def _poll_until_done(self, client, task_id, headers) -> str:
        waited = 0.0
        while waited < self._timeout:
            q = await client.get(f"{self._base_url}/query/video_generation",
                                 params={"task_id": task_id}, headers=headers)
            data = q.json()
            status = data.get("status")
            if status == "Success":
                file_id = data.get("file_id")
                if not file_id:
                    raise DomainError(ErrorCode.MODEL_OUTPUT_INVALID, "minimax 成功但无 file_id")
                return file_id
            if status == "Fail":
                raise DomainError(ErrorCode.INTERNAL, f"minimax 生成失败: {data}")
            await asyncio.sleep(self._poll)
            waited += self._poll
        raise DomainError(ErrorCode.RESOURCE_LIMIT, "minimax 图生视频轮询超时")
