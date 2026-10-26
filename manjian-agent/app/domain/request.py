"""任务输入契约（见文档 02 章）。

request_id 是幂等键示意，不是用户身份凭证。身份与积分由上游 Go 服务负责；
Python 不能因为请求体中出现某个 user_id 就默认信任它。
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class CreateTaskRequest(BaseModel):
    request_id: str = Field(min_length=1, max_length=128)
    topic: str = Field(min_length=1, max_length=300)
    style: str = Field(default="现代、温柔清冷", max_length=100)
    target_seconds: int = Field(default=15, ge=5, le=60)
    language: Literal["zh-CN"] = "zh-CN"
    material_policy: Literal["licensed_first_ai_fallback"] = "licensed_first_ai_fallback"
    max_scenes: int = Field(default=8, ge=1, le=20)
    max_generated_images: int = Field(default=6, ge=0, le=12)
    # 人工介入（HITL）：为 True 时在各关键创作步骤后暂停，等待人工审核
    hitl: bool = False
