"""TTS provider 协议与共享工具（文档 08.1）。

provider 只负责把一段已校验文本合成为本地音频文件；时长测量、字幕、落库由上层服务控制。
"""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Protocol, runtime_checkable


def text_hash(text: str) -> str:
    return hashlib.sha256(text.strip().encode("utf-8")).hexdigest()


@runtime_checkable
class TTSProvider(Protocol):
    name: str
    model: str
    audio_ext: str  # "wav" / "mp3"

    async def synthesize(self, text: str, *, out_path: Path, voice: str, speed: float) -> Path:
        """合成音频写入 out_path，返回该路径。"""
        ...
