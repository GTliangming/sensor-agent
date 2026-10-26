"""图生视频 → 每场景规整短片（文档 01 视频生成升级）。

对每个场景：取静态图 -> provider.image_to_video -> ffmpeg 规整到 WxH/fps 与目标时长，并决定音轨来源：
- use_tts=True：用自家 CosyVoice 音频，视频裁到旁白时长；
- use_tts=False：保留视频自带音轨（如海螺 H3），时长取视频实际时长。
各场景并发生成（信号量限流）；所有阻塞的 ffmpeg/ffprobe 调用走线程池，不堵塞事件循环。
"""
from __future__ import annotations

import asyncio
import subprocess
import time
from pathlib import Path

from app.config import Settings
from app.domain.plans import AudioPlan
from app.domain.storyboard import Scene, Storyboard
from app.observability.logging import get_logger
from app.providers.video.base import VideoProvider
from app.repositories.sqlite import TaskRepository
from app.services.assets.asset_resolver import resolve_scene_images
from app.services.media.ffprobe_service import probe_duration

logger = get_logger(__name__)


class VideoClipService:
    def __init__(self, provider: VideoProvider, repo: TaskRepository, settings: Settings):
        self._provider = provider
        self._repo = repo
        self._w = settings.video_width
        self._h = settings.video_height
        self._fps = settings.video_fps
        self._clip_seconds = settings.video_clip_seconds
        self._timeout = settings.render_timeout_seconds
        self._tasks_dir = settings.tasks_dir
        self._sem = asyncio.Semaphore(max(1, settings.max_scene_concurrency))

    async def build(self, task_id: str, storyboard: Storyboard, asset_plan: dict,
                    audio_plan: AudioPlan | None, use_tts: bool) -> list[dict]:
        t0 = time.perf_counter()
        raw_dir = self._tasks_dir / task_id / "video_raw"
        clip_dir = self._tasks_dir / task_id / "scene_clips"
        clip_dir.mkdir(parents=True, exist_ok=True)

        image_by_scene = self._resolve_images(asset_plan)
        audio_by_scene = {s["scene_id"]: s for s in (audio_plan.segments if audio_plan else [])}
        ordered = sorted(storyboard.scenes, key=lambda s: s.order)

        async def _one(scene: Scene) -> dict:
            async with self._sem:
                return await self._build_scene(scene, raw_dir, clip_dir, image_by_scene,
                                               audio_by_scene, use_tts)

        clips = await asyncio.gather(*[_one(s) for s in ordered])
        logger.info("图生视频完成 task=%s clips=%s use_tts=%s", task_id, len(clips), use_tts)
        self._repo.add_agent_run(
            task_id, "video", model_name=self._provider.model,
            latency_ms=int((time.perf_counter() - t0) * 1000),
            usage={"clips": len(clips), "use_tts": use_tts})
        return list(clips)

    async def _build_scene(self, scene: Scene, raw_dir: Path, clip_dir: Path,
                           image_by_scene: dict, audio_by_scene: dict, use_tts: bool) -> dict:
        still = image_by_scene.get(scene.scene_id)
        if still is None or not Path(still).exists():
            raise RuntimeError(f"场景 {scene.scene_id} 缺少静态图，无法图生视频")

        raw = raw_dir / f"{scene.scene_id}.mp4"
        await self._provider.image_to_video(
            Path(still), scene.visual_prompt, out_path=raw, seconds=self._clip_seconds)

        tts_audio = None
        raw_dur = await asyncio.to_thread(probe_duration, raw)
        if use_tts:
            seg = audio_by_scene.get(scene.scene_id)
            if not seg or not Path(seg["file_path"]).exists():
                raise RuntimeError(f"场景 {scene.scene_id} 缺少 TTS 音频")
            tts_audio = Path(seg["file_path"])
            target = min(float(seg["duration_seconds"]), raw_dur)
        else:
            target = raw_dur

        clip = clip_dir / f"{scene.scene_id}.mp4"
        await asyncio.to_thread(self._normalize, raw, tts_audio, target, clip)
        return {"scene_id": scene.scene_id, "order": scene.order,
                "clip_path": str(clip), "duration": round(target, 3)}

    def _resolve_images(self, asset_plan: dict) -> dict[str, str]:
        return resolve_scene_images(self._repo, asset_plan)

    def _normalize(self, raw: Path, tts_audio: Path | None, target: float, out: Path) -> None:
        vf = (f"scale={self._w}:{self._h}:force_original_aspect_ratio=increase,"
              f"crop={self._w}:{self._h},setsar=1,fps={self._fps},format=yuv420p")
        cmd = ["ffmpeg", "-y", "-i", str(raw)]
        if tts_audio is not None:
            cmd += ["-i", str(tts_audio), "-map", "0:v:0", "-map", "1:a:0"]
        cmd += ["-t", f"{target:.3f}", "-vf", vf, "-r", str(self._fps),
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(out)]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=self._timeout)
        if proc.returncode != 0:
            raise RuntimeError(f"规整短片失败: {proc.stderr.strip()[-200:]}")
