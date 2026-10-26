"""素材检索与打分（文档 06）。

原则：
- 版权优先：先用 is_commercially_usable 过滤，无权使用的素材绝不进入候选（哪怕语义匹配高）。
- 可解释加权分（文档 06.2）：
    score = 0.35*tag + 0.25*semantic + 0.15*aspect_ratio + 0.15*quality + 0.10*freshness
  权重只是起始假设，后续应用人工标注样本调参。
- tag / semantic 只基于主题标签与关键词，不把 mood 这类通用字段算进内容相关性，
  避免"同情绪就算相关"。
- 命中还要求"有内容相关性"：仅靠画幅/质量/新鲜度把总分顶过阈值不算命中，
  否则任何竖屏高质量图都会被硬塞给无关场景。tag + semantic 必须 > 0。
- 先用字段过滤 + 标签/关键词匹配建立基线，Recall 不够再引入 embedding/向量库。
"""
from __future__ import annotations

import re

from app.domain.assets import Asset
from app.domain.plans import AssetCandidate, AssetPlan, SceneMatch
from app.domain.request import CreateTaskRequest
from app.domain.storyboard import Scene, Storyboard

TARGET_ASPECT_RATIO = "9:16"  # 竖屏（文档 08 RenderPlan 默认 1080x1920）
SCORE_THRESHOLD = 0.35
MIN_CONTENT_RELEVANCE = 1e-6  # tag+semantic 必须大于 0 才算真正相关
TOP_K = 5

WEIGHTS = {
    "tag": 0.35,
    "semantic": 0.25,
    "aspect_ratio": 0.15,
    "quality": 0.15,
    "freshness": 0.10,
}

_TOKEN_RE = re.compile(r"[\w\u4e00-\u9fff]+")


def _tokens(text: str) -> set[str]:
    return {t.lower() for t in _TOKEN_RE.findall(text or "") if t}


def _overlap(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a)


def _aspect_score(asset: Asset) -> float:
    if not asset.aspect_ratio:
        return 0.5  # 未知画幅：中性，不奖励也不重罚
    return 1.0 if asset.aspect_ratio == TARGET_ASPECT_RATIO else 0.2


def _freshness(asset: Asset) -> float:
    return 1.0 / (1.0 + asset.usage_count)


def score_asset(scene: Scene, asset: Asset) -> tuple[float, dict[str, float]]:
    scene_tags = {t.lower() for t in scene.tags}
    asset_tags = {t.lower() for t in asset.tags}
    tag = _overlap(scene_tags, asset_tags)

    scene_sem = _tokens(scene.visual_prompt) | _tokens(scene.narration)
    asset_sem = asset_tags | _tokens(asset.source_name)
    semantic = _overlap(scene_sem, asset_sem)

    parts = {
        "tag": tag,
        "semantic": semantic,
        "aspect_ratio": _aspect_score(asset),
        "quality": asset.quality_score,
        "freshness": _freshness(asset),
    }
    total = sum(WEIGHTS[k] * v for k, v in parts.items())
    breakdown = {k: round(v, 4) for k, v in parts.items()}
    return round(total, 4), breakdown


def _is_hit(score: float, breakdown: dict[str, float]) -> bool:
    content = breakdown["tag"] + breakdown["semantic"]
    return score >= SCORE_THRESHOLD and content > MIN_CONTENT_RELEVANCE


class AssetRetriever:
    def __init__(self, assets: list[Asset]):
        # 版权优先：只保留可商用的图片素材，授权未知直接排除
        self._pool = [a for a in assets if a.asset_type == "image" and a.is_commercially_usable]
        self._excluded = len(assets) - len(self._pool)

    def match(self, storyboard: Storyboard, request: CreateTaskRequest, task_id: str) -> AssetPlan:
        scene_matches: list[SceneMatch] = []
        gaps: list[str] = []

        for scene in storyboard.scenes:
            scored = sorted(
                ((score_asset(scene, a), a) for a in self._pool),
                key=lambda x: x[0][0],
                reverse=True,
            )
            candidates = [
                AssetCandidate(asset_id=a.asset_id, score=sc[0], breakdown=sc[1])
                for sc, a in scored[:TOP_K]
            ]
            best = scored[0] if scored else None
            if best and _is_hit(best[0][0], best[0][1]):
                scene_matches.append(
                    SceneMatch(
                        scene_id=scene.scene_id, order=scene.order,
                        chosen_asset_id=best[1].asset_id, chosen_score=best[0][0],
                        candidates=candidates, gap=False,
                        reason=f"命中授权素材 score={best[0][0]}",
                    )
                )
            else:
                gaps.append(scene.scene_id)
                if not scored:
                    reason = "候选池为空（无可商用素材）"
                else:
                    reason = f"最高分 {best[0][0]} 未达阈值或内容不相关"
                scene_matches.append(
                    SceneMatch(
                        scene_id=scene.scene_id, order=scene.order,
                        candidates=candidates, gap=True, reason=reason,
                    )
                )

        hit = len(storyboard.scenes) - len(gaps)
        stats = {
            "scene_count": len(storyboard.scenes),
            "hit_count": hit,
            "gap_count": len(gaps),
            "hit_rate": round(hit / len(storyboard.scenes), 4) if storyboard.scenes else 0.0,
            "pool_size": len(self._pool),
            "excluded_unlicensed": self._excluded,
        }
        return AssetPlan(
            task_id=task_id, producer="asset_retrieval",
            scene_matches=scene_matches, gaps=gaps, stats=stats,
        )
