"""ffprobe 探测封装（文档 08.3）。

用于：测量 TTS 音频真实时长、校验渲染输出的容器/视频流/音频流/时长/分辨率。
调用 subprocess 使用参数数组，不拼接 shell 字符串。
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

from app.observability.logging import get_logger

logger = get_logger(__name__)


def ffprobe_available() -> bool:
    return shutil.which("ffprobe") is not None


def probe_duration(path: Path) -> float:
    """返回媒体时长（秒）。失败抛 RuntimeError。"""
    out = _run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path),
    ])
    try:
        return float(out.strip())
    except ValueError as exc:
        raise RuntimeError(f"无法解析时长: {out!r}") from exc


def probe_media(path: Path) -> dict:
    """返回 {format, duration, video:{codec,width,height}|None, audio:{codec}|None}。"""
    raw = _run([
        "ffprobe", "-v", "error", "-show_entries",
        "format=format_name,duration:stream=codec_type,codec_name,width,height",
        "-of", "json", str(path),
    ])
    data = json.loads(raw)
    fmt = data.get("format", {})
    video = audio = None
    for s in data.get("streams", []):
        if s.get("codec_type") == "video" and video is None:
            video = {"codec": s.get("codec_name"), "width": s.get("width"), "height": s.get("height")}
        elif s.get("codec_type") == "audio" and audio is None:
            audio = {"codec": s.get("codec_name")}
    return {
        "format_name": fmt.get("format_name"),
        "duration": float(fmt["duration"]) if fmt.get("duration") else None,
        "video": video,
        "audio": audio,
    }


def _run(cmd: list[str]) -> str:
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise RuntimeError(f"ffprobe 失败 rc={proc.returncode}: {proc.stderr.strip()[:200]}")
    return proc.stdout
