"""Agent 之间的交接契约（见文档 02.4 / 04 章）。

当前阶段实现到 Storyboard + AssetPlan。其余交接对象（AudioPlan/RenderPlan/QualityReport）
预留骨架，让单图升级为多 Agent 子图时通过 schema 交接，而不是自然语言长聊。
每个交接对象都带 task_id / schema_version / producer / created_at，便于审计与兼容升级。
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, Field


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


class Handoff(BaseModel):
    """所有 Agent 交接对象的公共信封。"""

    task_id: str
    schema_version: str = "1.0"
    producer: str
    created_at: str = Field(default_factory=_now_iso)
    warnings: list[str] = Field(default_factory=list)


class CreativeBrief(Handoff):
    """Creative Agent 输出：主题、受众、风格、时长、禁用元素。"""

    topic: str
    audience: str = "通用"
    style: str = ""
    target_seconds: int = 15
    forbidden_elements: list[str] = Field(default_factory=list)


class AssetCandidate(BaseModel):
    """某场景的一个候选素材及其可解释打分。"""

    asset_id: str
    score: float
    breakdown: dict[str, float] = Field(default_factory=dict)


class SceneMatch(BaseModel):
    """某场景的素材匹配结果。"""

    scene_id: str
    order: int
    chosen_asset_id: str | None = None
    chosen_score: float | None = None
    candidates: list[AssetCandidate] = Field(default_factory=list)
    gap: bool = True  # True 表示无可用授权素材，需补图
    reason: str = ""


class AssetPlan(Handoff):
    """Asset Agent 输出：每个场景的候选素材、命中与缺口（文档 06）。"""

    scene_matches: list[SceneMatch] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)  # 需要补图的 scene_id
    stats: dict[str, Any] = Field(default_factory=dict)


class AudioPlan(Handoff):
    """Voice 服务输出：TTS 文本、音色、语速、片段顺序。（阶段 4 实现）"""

    segments: list[dict[str, Any]] = Field(default_factory=list)


class RenderPlan(Handoff):
    """Editing 服务输出：素材/音频/字幕路径与输出规格 + 渲染结果（文档 08）。"""

    width: int = 1080
    height: int = 1920
    fps: int = 30
    scenes: list[dict[str, Any]] = Field(default_factory=list)
    subtitle_path: str = ""
    output_path: str = ""
    duration_seconds: float = 0.0
    validated: bool = False
    probe: dict[str, Any] = Field(default_factory=dict)


class QualityReport(Handoff):
    """Quality Agent 输出：检查项、错误、警告、是否允许继续。（阶段 6 实现）"""

    passed: bool = True
    checks: list[dict[str, Any]] = Field(default_factory=list)
