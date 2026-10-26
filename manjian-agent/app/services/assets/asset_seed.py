"""导入测试素材及其许可元数据（文档 12 阶段2）。

开发/测试用：把 data/assets/seed_assets.json 里的授权素材导入 assets 表。
同时为每条素材的 local_path 生成一张占位 PNG（种子素材只有元数据、没有真实图片文件），
这样被命中的场景在阶段 4 渲染时也有真实图片可用。生产环境应使用真实授权素材文件。
"""
from __future__ import annotations

import json
from pathlib import Path

from app.config import PROJECT_ROOT
from app.media_util import write_solid_png
from app.observability.logging import get_logger
from app.repositories.sqlite import TaskRepository

logger = get_logger(__name__)

DEFAULT_SEED = PROJECT_ROOT / "data" / "assets" / "seed_assets.json"


def load_seed_assets(path: str | Path | None = None) -> list[dict]:
    p = Path(path) if path else DEFAULT_SEED
    if not p.exists():
        logger.warning("种子素材文件不存在: %s", p)
        return []
    return json.loads(p.read_text(encoding="utf-8"))


def _ensure_placeholder_file(local_path: str) -> None:
    if not local_path:
        return
    p = Path(local_path)
    if not p.is_absolute():
        p = PROJECT_ROOT / p
    if not p.exists():
        write_solid_png(p, 64, 114)


def seed_demo_assets(repo: TaskRepository, path: str | Path | None = None, *, force: bool = False) -> int:
    """导入素材。已有素材且非 force 时跳过。返回导入条数。"""
    if not force and repo.count_assets() > 0:
        return 0
    assets = load_seed_assets(path)
    for a in assets:
        repo.upsert_asset(a)
        _ensure_placeholder_file(a.get("local_path", ""))
    logger.info("导入测试素材 %s 条（含占位图片文件）", len(assets))
    return len(assets)
