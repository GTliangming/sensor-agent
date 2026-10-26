"""分镜领域对象（见文档 02 章）。

稳定的数据契约。后端不得直接信任模型给出的 duration_seconds 总和，
需在节点里做确定性校验/修正（见 graph/nodes/validate.py）。
"""
from __future__ import annotations

from pydantic import BaseModel, Field, model_validator


class Scene(BaseModel):
    scene_id: str
    order: int = Field(ge=1)
    narration: str = Field(min_length=1, max_length=500)
    visual_prompt: str = Field(min_length=1, max_length=1000)
    duration_seconds: float = Field(gt=0, le=15)
    mood: str = "neutral"
    tags: list[str] = Field(default_factory=list)
    needs_character_consistency: bool = True


class Storyboard(BaseModel):
    title: str = Field(min_length=1)
    hook: str = Field(min_length=1)
    closing_line: str = Field(min_length=1)
    scenes: list[Scene] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def validate_order_and_unique(self):
        orders = [scene.order for scene in self.scenes]
        if orders != list(range(1, len(self.scenes) + 1)):
            raise ValueError("scene order must be continuous and start at 1")
        if len({scene.scene_id for scene in self.scenes}) != len(self.scenes):
            raise ValueError("scene_id must be unique")
        return self

    @property
    def total_duration(self) -> float:
        return round(sum(s.duration_seconds for s in self.scenes), 3)
