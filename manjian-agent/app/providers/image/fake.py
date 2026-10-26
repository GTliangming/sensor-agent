"""本地确定性图像 provider（无网络）。

写出一张合法的小尺寸 PNG 占位图，用于开发与测试，让补图链路可离线跑通。
"""
from __future__ import annotations

from pathlib import Path

from app.media_util import write_solid_png
from app.observability.logging import get_logger

logger = get_logger(__name__)

# 占位图固定用小尺寸，文件很小；真实尺寸由线上 provider 负责
_PLACEHOLDER_W = 64
_PLACEHOLDER_H = 114  # 近似 9:16


class FakeImageProvider:
    name = "fake"
    model = "fake-image"

    async def generate(
        self, prompt: str, *, width: int, height: int, idempotency_key: str, out_path: Path
    ) -> Path:
        write_solid_png(out_path, _PLACEHOLDER_W, _PLACEHOLDER_H)
        logger.info("fake image 生成占位图 -> %s", out_path.name)
        return out_path
