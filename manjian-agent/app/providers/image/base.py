"""图像 provider 协议与共享工具（文档 07）。

provider 只负责"把提示词变成一张本地图片文件"，并返回路径。
预算、缓存命中、缺口判断、资产落库由上层服务 / 节点控制（文档 03.3）。
"""
from __future__ import annotations

import hashlib
import re
import struct
from pathlib import Path
from typing import Protocol, runtime_checkable

from app.domain.request import CreateTaskRequest
from app.domain.storyboard import Scene

# 提示词版本：改变提示词拼装逻辑时递增，使缓存键失效（文档 07.4）
PROMPT_VERSION = "img-v1"

_PNG_SIG = b"\x89PNG\r\n\x1a\n"


def build_image_prompt(scene: Scene, request: CreateTaskRequest) -> str:
    """从结构化字段拼装提示词，不直接把任意用户输入塞进系统指令（文档 07.2）。"""
    parts = [
        scene.visual_prompt.strip(),
        f"风格：{request.style}",
        "竖屏构图，9:16，柔和光线，画面干净",
        "禁止：文字水印、错误肢体、多余人物",
    ]
    return "，".join(p for p in parts if p)


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip()).lower()


def cache_key(provider: str, model: str, prompt: str, width: int, height: int) -> str:
    raw = f"{provider}|{model}|{_normalize(prompt)}|{width}x{height}|{PROMPT_VERSION}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def validate_image_file(path: Path, *, min_bytes: int = 64) -> tuple[int, int]:
    """校验是合法图片且非空；返回 (width, height)。失败抛 ValueError。"""
    if not path.exists():
        raise ValueError(f"图片文件不存在: {path}")
    data = path.read_bytes()
    if len(data) < min_bytes:
        raise ValueError(f"图片文件过小（{len(data)} bytes）")
    if data[:8] == _PNG_SIG:
        # PNG：从 IHDR 读取宽高
        w, h = struct.unpack(">II", data[16:24])
        return w, h
    if data[:2] == b"\xff\xd8":  # JPEG
        return _jpeg_dimensions(data)
    raise ValueError("无法识别的图片格式（仅支持 PNG / JPEG）")


def _jpeg_dimensions(data: bytes) -> tuple[int, int]:
    i = 2
    n = len(data)
    while i + 9 < n:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            h = struct.unpack(">H", data[i + 5:i + 7])[0]
            w = struct.unpack(">H", data[i + 7:i + 9])[0]
            return w, h
        seg_len = struct.unpack(">H", data[i + 2:i + 4])[0]
        i += 2 + seg_len
    return 0, 0


@runtime_checkable
class ImageProvider(Protocol):
    name: str
    model: str

    async def generate(
        self, prompt: str, *, width: int, height: int, idempotency_key: str, out_path: Path
    ) -> Path:
        """生成图片并写入 out_path，返回该路径。"""
        ...
