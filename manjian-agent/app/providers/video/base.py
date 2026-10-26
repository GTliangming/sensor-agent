"""图生视频 provider 协议与共享工具（文档 01：视频生成为后续升级）。

provider 只负责"给一张图 + 提示词 -> 一段视频文件"；时长适配、音频取舍、拼接由上层服务控制。
"""
from __future__ import annotations

import base64
import mimetypes
from pathlib import Path
from typing import Protocol, runtime_checkable


def image_to_data_uri(path: Path) -> str:
    mime = mimetypes.guess_type(str(path))[0] or "image/png"
    b64 = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{b64}"


@runtime_checkable
class VideoProvider(Protocol):
    name: str
    model: str
    produces_audio: bool  # 模型产物是否自带音轨（如海螺 H3）

    async def image_to_video(
        self, image: Path, prompt: str, *, out_path: Path, seconds: float
    ) -> Path:
        """以 image 为首帧生成视频写入 out_path，返回该路径。"""
        ...
