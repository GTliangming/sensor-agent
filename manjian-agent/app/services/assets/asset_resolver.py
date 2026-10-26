"""把 AssetPlan 里每个场景选中的 asset_id 解析成本地图片路径。

render / video 两条渲染路径共用，避免各写一份。
"""
from __future__ import annotations

from app.repositories.sqlite import TaskRepository


def resolve_scene_images(repo: TaskRepository, asset_plan: dict) -> dict[str, str]:
    out: dict[str, str] = {}
    for m in asset_plan.get("scene_matches", []):
        aid = m.get("chosen_asset_id")
        if not aid:
            continue
        asset = repo.get_asset(aid)
        if asset and asset.get("local_path"):
            out[m["scene_id"]] = asset["local_path"]
    return out
