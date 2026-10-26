"""本地确定性 TTS provider（无网络）。

按文本长度估算时长，写一段静音 WAV（时长可控、ffprobe 可读），让配音/字幕/渲染链路离线跑通。
不克隆任何真实人物声音。
"""
from __future__ import annotations

from pathlib import Path

from app.media_util import write_silence_wav
from app.observability.logging import get_logger

logger = get_logger(__name__)

_CHARS_PER_SEC = 5.0  # 粗略中文语速估计
_MIN_SECONDS = 0.8


class FakeTTSProvider:
    name = "fake"
    model = "fake-tts"
    audio_ext = "wav"

    async def synthesize(self, text: str, *, out_path: Path, voice: str, speed: float) -> Path:
        seconds = max(_MIN_SECONDS, len(text.strip()) / (_CHARS_PER_SEC * max(speed, 0.1)))
        write_silence_wav(out_path, seconds)
        logger.info("fake tts 合成静音 %.2fs -> %s", seconds, out_path.name)
        return out_path
