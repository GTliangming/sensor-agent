"""健康检查（文档 09.1）。

/healthz：进程存活。
/readyz：依赖可用性（数据库、工作目录、ffmpeg）。
"""
from __future__ import annotations

import shutil

from fastapi import APIRouter

from app.config import get_settings

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def healthz() -> dict:
    return {"status": "ok"}


@router.get("/readyz")
async def readyz() -> dict:
    settings = get_settings()
    checks = {
        "data_dir": settings.data_path.exists(),
        "db_parent": settings.db_file.parent.exists(),
        "ffmpeg": shutil.which("ffmpeg") is not None,
        "ffprobe": shutil.which("ffprobe") is not None,
    }
    # ffmpeg/ffprobe 当前阶段非必需（渲染在阶段 4），缺失不阻断就绪
    ready = checks["data_dir"] and checks["db_parent"]
    return {"ready": ready, "checks": checks, "text_provider": settings.resolved_text_provider}
