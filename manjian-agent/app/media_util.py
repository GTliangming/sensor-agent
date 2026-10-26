"""无第三方依赖的本地媒体工具（仅标准库）。

- make_solid_png：生成一张纯色 PNG（用于 fake 图像、种子素材占位文件）。
- write_silence_wav：生成一段静音 WAV（用于 fake TTS，时长可控、ffprobe 可读）。
不依赖 PIL / ffmpeg。
"""
from __future__ import annotations

import struct
import wave
import zlib
from pathlib import Path


def make_solid_png(width: int, height: int, rgb: tuple[int, int, int] = (90, 110, 130)) -> bytes:
    def chunk(typ: bytes, data: bytes) -> bytes:
        body = typ + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # 8-bit RGB
    row = b"\x00" + bytes(rgb) * width
    raw = row * height
    idat = zlib.compress(raw, 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def write_solid_png(path: Path, width: int, height: int, rgb: tuple[int, int, int] = (90, 110, 130)) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(make_solid_png(width, height, rgb))
    return path


def write_silence_wav(path: Path, seconds: float, *, sample_rate: int = 16000) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    frames = max(1, int(seconds * sample_rate))
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)  # 16-bit
        w.setframerate(sample_rate)
        w.writeframes(b"\x00\x00" * frames)
    return path
