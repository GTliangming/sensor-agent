"""本地确定性图生视频 provider（无网络）。

用 ffmpeg 把静态图做成带缓慢运镜（zoompan）的短片，并挂一条静音音轨，
让"图生视频 + 视频自带音轨"的链路可离线端到端验证。
"""
from __future__ import annotations

import asyncio
import subprocess
from pathlib import Path

from app.observability.logging import get_logger

logger = get_logger(__name__)


class FakeVideoProvider:
    name = "fake"
    model = "fake-video"
    produces_audio = True

    def __init__(self, width: int = 1080, height: int = 1920, fps: int = 30):
        self._w, self._h, self._fps = width, height, fps

    async def image_to_video(self, image: Path, prompt: str, *, out_path: Path, seconds: float) -> Path:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        frames = max(1, round(seconds * self._fps))
        vf = (
            f"scale={self._w}:{self._h}:force_original_aspect_ratio=increase,"
            f"crop={self._w}:{self._h},"
            f"zoompan=z='min(zoom+0.0012,1.12)':d={frames}:"
            f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':fps={self._fps}:s={self._w}x{self._h},"
            f"setsar=1,format=yuv420p"
        )
        cmd = [
            "ffmpeg", "-y", "-i", str(image),
            "-f", "lavfi", "-t", f"{seconds:.3f}", "-i", "anullsrc=r=44100:cl=stereo",
            "-vf", vf, "-r", str(self._fps), "-t", f"{seconds:.3f}",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(out_path),
        ]
        proc = await asyncio.to_thread(
            subprocess.run, cmd, capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise RuntimeError(f"fake video ffmpeg 失败: {proc.stderr.strip()[-200:]}")
        logger.info("fake video 生成 %.1fs -> %s", seconds, out_path.name)
        return out_path
