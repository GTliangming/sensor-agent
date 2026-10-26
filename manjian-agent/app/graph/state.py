"""单 Agent 主图共享状态（见文档 03.2 / 05.2）。

共享 State 只存跨节点必须传递的数据，不放完整视频二进制或超大模型历史。
文件只传路径 / 对象存储 key / 数据库 ID。
errors 使用 append reducer 累积；其余结构化对象是 replace 更新。
"""
from __future__ import annotations

import operator
from enum import StrEnum
from typing import Annotated, Any, NotRequired, TypedDict


class Stage(StrEnum):
    VALIDATE_REQUEST = "validate_request"
    STORYBOARDING = "storyboarding"
    VALIDATE_STORYBOARD = "validate_storyboard"
    ASSET_SEARCH = "asset_search"
    IMAGE_GENERATION = "image_generation"
    ANIMATING = "animating"
    TTS = "tts"
    SUBTITLES = "subtitles"
    RENDERING = "rendering"
    VALIDATING = "validating"
    DONE = "done"


class TaskStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCEL_REQUESTED = "cancel_requested"
    CANCELLED = "cancelled"
    # 阶段 0-1：分镜已生成，后续链路（素材/配音/渲染）尚未实现
    STORYBOARD_READY = "storyboard_ready"


class AgentState(TypedDict):
    task_id: str
    request: dict
    status: str
    stage: NotRequired[str]
    storyboard: NotRequired[dict]
    asset_plan: NotRequired[dict]
    audio_plan: NotRequired[dict]
    render_plan: NotRequired[dict]
    subtitle_path: NotRequired[str]
    scene_clips: NotRequired[list[dict[str, Any]]]
    route_decision: NotRequired[str]
    quality_report: NotRequired[dict]
    errors: Annotated[list[dict[str, Any]], operator.add]
    llm_calls: Annotated[int, operator.add]
    retry_counts: NotRequired[dict[str, int]]
