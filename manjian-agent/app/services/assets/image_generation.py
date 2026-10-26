"""AI 补图服务（文档 07，阶段 3）。

- 只对预算内缺口生成；相同 provider+model+提示词+尺寸 命中内容哈希缓存。
- 各缺口场景并发生成（信号量限流）。
- 渲染兜底：预算外或生成失败仍留缺口的场景，用本地占位图补齐（零 API 成本），
  保证每个场景都有可渲染的图，不会在渲染阶段整体崩溃；并记录告警。
"""
from __future__ import annotations

import asyncio
import time

from app.config import Settings
from app.domain.assets import Asset
from app.domain.plans import AssetPlan
from app.domain.request import CreateTaskRequest
from app.domain.storyboard import Scene, Storyboard
from app.media_util import write_solid_png
from app.observability.logging import get_logger
from app.providers.image.base import (
    ImageProvider,
    build_image_prompt,
    cache_key,
    sha256_file,
    validate_image_file,
)
from app.repositories.sqlite import TaskRepository

logger = get_logger(__name__)

_MOOD_RGB = {
    "warm": (150, 110, 90), "calm": (90, 110, 130), "serene": (80, 110, 120),
    "excited": (150, 90, 90), "neutral": (110, 110, 110),
}


class ImageGenerationService:
    def __init__(self, provider: ImageProvider, repo: TaskRepository, settings: Settings):
        self._provider = provider
        self._repo = repo
        self._gen_dir = settings.generated_dir
        self._w, self._h = settings.image_wh
        self._sem = asyncio.Semaphore(max(1, settings.max_scene_concurrency))

    async def fill_gaps(self, storyboard: Storyboard, request: CreateTaskRequest, plan: AssetPlan) -> AssetPlan:
        t0 = time.perf_counter()
        to_generate: list[str] = list(plan.stats.get("to_generate", []))
        scene_by_id = {s.scene_id: s for s in storyboard.scenes}
        match_by_id = {m.scene_id: m for m in plan.scene_matches}

        async def _one(sid: str):
            scene = scene_by_id.get(sid)
            if scene is None:
                return sid, None, False
            async with self._sem:
                try:
                    asset, cached = await self._generate_for_scene(scene, request, plan.task_id)
                    return sid, asset, cached
                except Exception as exc:  # noqa: BLE001 - 单场景失败不阻断
                    logger.warning("补图失败 scene=%s: %s", sid, exc)
                    return sid, None, False

        results = await asyncio.gather(*[_one(sid) for sid in to_generate])
        generated: list[str] = []
        failed: list[str] = []
        cache_hits = 0
        for sid, asset, cached in results:
            m = match_by_id.get(sid)
            if asset is None or m is None:
                failed.append(sid)
                continue
            cache_hits += int(cached)
            m.gap = False
            m.chosen_asset_id = asset.asset_id
            m.chosen_score = None
            m.reason = "AI 生成补图" + ("（缓存命中）" if cached else "")
            generated.append(sid)

        done = set(generated)
        plan.gaps = [g for g in plan.gaps if g not in done]

        # 渲染兜底：仍然缺口的场景用本地占位图补齐
        placeholders = self._fill_with_placeholders(plan, scene_by_id, match_by_id)

        plan.stats["generated_count"] = len(generated)
        plan.stats["generation_cache_hits"] = cache_hits
        plan.stats["generation_failed"] = failed
        plan.stats["placeholder_count"] = len(placeholders)
        if placeholders:
            plan.warnings.append(f"{len(placeholders)} 个场景用占位图兜底（预算外或生成失败）: {placeholders}")
        logger.info("补图完成 task=%s generated=%s cache_hits=%s failed=%s placeholders=%s",
                    plan.task_id, len(generated), cache_hits, len(failed), len(placeholders))
        self._repo.add_agent_run(
            plan.task_id, "image", model_name=self._provider.model,
            latency_ms=int((time.perf_counter() - t0) * 1000),
            usage={"generated": len(generated), "cache_hits": cache_hits,
                   "failed": len(failed), "placeholders": len(placeholders)})
        return plan

    def _fill_with_placeholders(self, plan: AssetPlan, scene_by_id, match_by_id) -> list[str]:
        filled: list[str] = []
        for sid in list(plan.gaps):
            scene = scene_by_id.get(sid)
            m = match_by_id.get(sid)
            if scene is None or m is None:
                continue
            path = self._gen_dir / f"placeholder_{sid}.png"
            write_solid_png(path, self._w, self._h, _MOOD_RGB.get(scene.mood, _MOOD_RGB["neutral"]))
            asset = Asset(asset_id=f"ph_{sid}", asset_type="image", source_type="generated",
                          source_name="本地占位图", local_path=str(path), license_type="placeholder",
                          commercial_use_allowed=True, content_hash=f"sha256:{sha256_file(path)}",
                          aspect_ratio="9:16", tags=scene.tags, mood=scene.mood, quality_score=0.1)
            self._repo.upsert_asset(asset.model_dump())
            m.gap = False
            m.chosen_asset_id = asset.asset_id
            m.reason = "占位图兜底"
            filled.append(sid)
        plan.gaps = [g for g in plan.gaps if g not in set(filled)]
        return filled

    async def _generate_for_scene(self, scene: Scene, request: CreateTaskRequest, task_id: str):
        prompt = build_image_prompt(scene, request)
        key = cache_key(self._provider.name, self._provider.model, prompt, self._w, self._h)
        cache_path = self._gen_dir / f"{key}.png"
        cached = cache_path.exists()
        if not cached:
            tmp = self._gen_dir / f"tmp_{key}.png"
            await self._provider.generate(prompt, width=self._w, height=self._h,
                                          idempotency_key=key, out_path=tmp)
            validate_image_file(tmp)
            tmp.replace(cache_path)
        validate_image_file(cache_path)
        asset = Asset(asset_id=f"gen_{key[:16]}", asset_type="image", source_type="generated",
                      source_name=f"AI生成({self._provider.model})", local_path=str(cache_path),
                      license_type="ai_generated", commercial_use_allowed=True,
                      content_hash=f"sha256:{sha256_file(cache_path)}", aspect_ratio="9:16",
                      tags=scene.tags, mood=scene.mood, quality_score=0.6)
        self._repo.upsert_asset(asset.model_dump())
        return asset, cached
