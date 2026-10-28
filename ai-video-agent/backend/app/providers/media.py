"""视频文件校验。

只有校验通过才允许把任务标记为成功（见 ComfyUI 接入文档 8.5）。
"""
import asyncio
import json
import shutil
from pathlib import Path

from app.core.exceptions import ProviderError


async def validate_video(path: Path) -> dict:
    """返回 {"width","height","duration"}（拿不到时为 None）。

    - 文件必须非空且带 MP4 的 ftyp 标记；
    - 本机装有 ffprobe 时，进一步确认存在可解码的视频流。
    """
    if not path.is_file() or path.stat().st_size == 0:
        raise ProviderError("RESULT_INVALID", "结果文件为空")
    with path.open("rb") as f:
        head = f.read(12)
    if head[4:8] != b"ftyp":
        raise ProviderError("RESULT_INVALID", "结果文件不是有效的 MP4")

    info: dict = {"width": None, "height": None, "duration": None}
    if not shutil.which("ffprobe"):
        return info  # 没有 ffprobe 时跳过深度校验

    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,duration", "-of", "json", str(path),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    out, _ = await proc.communicate()
    streams = json.loads(out or b"{}").get("streams") or []
    if proc.returncode != 0 or not streams:
        raise ProviderError("RESULT_INVALID", "结果文件无法解码或不含视频流")
    s = streams[0]
    info["width"], info["height"] = s.get("width"), s.get("height")
    info["duration"] = float(s["duration"]) if s.get("duration") else None
    return info
