"""配音服务（文档 08.1，阶段 4）。

逐场景合成旁白音频，时长以 ffprobe 实测为准；相同文本按 text_hash 复用。
各场景并发合成（信号量限流），ffprobe 走线程池不堵塞事件循环。
"""
from __future__ import annotations

import asyncio
import time
from pathlib import Path

from app.config import Settings
from app.domain.plans import AudioPlan
from app.domain.storyboard import Scene, Storyboard
from app.observability.logging import get_logger
from app.providers.tts.base import TTSProvider, text_hash
from app.repositories.sqlite import TaskRepository
from app.services.media.ffprobe_service import probe_duration

logger = get_logger(__name__)


class TTSService:
    def __init__(self, provider: TTSProvider, settings: Settings, repo: TaskRepository | None = None):
        self._provider = provider
        self._repo = repo
        self._tasks_dir = settings.tasks_dir
        self._voice = settings.tts_voice
        self._speed = settings.tts_speed
        self._sem = asyncio.Semaphore(max(1, settings.max_scene_concurrency))

    async def synthesize(self, storyboard: Storyboard, task_id: str) -> AudioPlan:
        t0 = time.perf_counter()
        audio_dir = self._tasks_dir / task_id / "audio"

        async def _one(scene: Scene) -> dict:
            async with self._sem:
                return await self._synth_scene(scene, audio_dir)

        ordered = sorted(storyboard.scenes, key=lambda s: s.order)
        segments = list(await asyncio.gather(*[_one(s) for s in ordered]))
        total = round(sum(s["duration_seconds"] for s in segments), 3)
        logger.info("tts 完成 task=%s segments=%s total=%.2fs", task_id, len(segments), total)
        if self._repo is not None:
            chars = sum(len(s["text"]) for s in segments)
            self._repo.add_agent_run(
                task_id, "tts", model_name=self._provider.model,
                latency_ms=int((time.perf_counter() - t0) * 1000),
                usage={"segments": len(segments), "chars": chars, "audio_seconds": total})
        return AudioPlan(task_id=task_id, producer="tts_service", segments=segments)

    async def _synth_scene(self, scene: Scene, audio_dir: Path) -> dict:
        th = text_hash(scene.narration)
        out = audio_dir / f"{scene.scene_id}_{th[:12]}.{self._provider.audio_ext}"
        cached = out.exists()
        if not cached:
            await self._provider.synthesize(scene.narration, out_path=out,
                                            voice=self._voice, speed=self._speed)
        duration = round(await asyncio.to_thread(probe_duration, out), 3)
        return {"scene_id": scene.scene_id, "order": scene.order, "text": scene.narration,
                "text_hash": th, "voice": self._voice, "model": self._provider.model,
                "file_path": str(out), "duration_seconds": duration, "cached": cached}
