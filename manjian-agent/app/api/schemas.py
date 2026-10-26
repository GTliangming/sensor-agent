"""API 输入输出模型（见文档 09 章）。

输入沿用领域契约 CreateTaskRequest；输出只暴露上游需要的字段，不泄露内部实现细节。
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel

from app.domain.request import CreateTaskRequest

__all__ = ["CreateTaskRequest", "CreateTaskResponse", "TaskView", "ReviewRequest"]


class CreateTaskResponse(BaseModel):
    task_id: str
    status: str
    created: bool


class TaskView(BaseModel):
    task_id: str
    request_id: str
    status: str
    stage: str | None = None
    result: dict[str, Any] | None = None
    error_code: str | None = None
    error_message: str | None = None
    created_at: str
    updated_at: str


class ReviewRequest(BaseModel):
    """人工审核决策。edit 为编辑后的产物（字幕传 {"srt": "..."}，其余传替换用的 JSON）。"""
    action: Literal["approve", "edit", "regenerate", "cancel"]
    feedback: str | None = None
    edit: Any | None = None
