"""生产流程相关结构。"""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ProductionCreate(BaseModel):
    account_id: str
    # 留空 = 由大模型自动选择主题
    topic: str = Field(default="", max_length=1000)
    # night：审核通过后等夜间窗口再生成（便宜）；now：审核通过后立即生成
    run_mode: Literal["night", "now"] = "night"
    duration_seconds: int = Field(default=15, ge=1, le=15)
    resolution: str | None = None  # 视频方向标签，缺省取工作流第一项
    seed: int | None = None  # 缺省取账号类型配置的 seed
    reference_file_ids: list[str] = Field(default_factory=list, max_length=8)


class ManualProductionCreate(BaseModel):
    """手动创建：不经过大模型和分镜/台词审核，直接用填写的提示词生成视频，生成后仍走成片审核。"""

    account_id: str
    topic: str = Field(min_length=1, max_length=1000)
    prompt: str = Field(min_length=1, max_length=20000)
    negative_prompt: str = Field(default="", max_length=2000)
    run_mode: Literal["night", "now"] = "now"
    duration_seconds: int = Field(ge=1, le=15)
    resolution: str
    seed: int | None = None
    reference_file_ids: list[str] = Field(default_factory=list, max_length=8)


class ManualDraft(BaseModel):
    """手动创建时预填的提示词：由账号类型当前的模板渲染而来，用户在此基础上修改。
    shot_template / dialogue_template 是「镜头写法」「台词写法」的原文（含 {{变量}}），供前端按需插入。"""

    prompt: str
    negative_prompt: str
    shot_template: str = ""
    dialogue_template: str = ""


class SubtitleItem(BaseModel):
    start: str = ""
    end: str = ""
    text: str = Field(min_length=1, max_length=200)


class SceneItem(BaseModel):
    scene_id: int
    scene_desc: str = Field(min_length=1, max_length=500)
    action_desc: str = Field(min_length=1, max_length=500)
    camera_desc: str = Field(min_length=1, max_length=500)


class ApproveSceneRequest(BaseModel):
    """审核 A：直接改分镜后通过；不传表示原样通过。"""

    scenes: list[SceneItem] | None = Field(default=None, min_length=1, max_length=8)


class ApproveDialogueRequest(BaseModel):
    """审核 B：直接改台词与字幕后通过。"""

    tts_text: str | None = Field(default=None, min_length=1, max_length=2000)
    subtitles: list[SubtitleItem] | None = Field(default=None, min_length=1, max_length=30)


class RegenerateRequest(BaseModel):
    feedback: str = Field(min_length=1, max_length=1000, description="修改意见，会和上一版一起交给模型")


class RegenerateVideoRequest(BaseModel):
    """重新生成视频：会产生新一次 GPU 费用。可顺带修改分镜/台词。"""

    scenes: list[SceneItem] | None = Field(default=None, min_length=1, max_length=8)
    tts_text: str | None = Field(default=None, min_length=1, max_length=2000)
    prompt: str | None = Field(default=None, min_length=1, max_length=20000, description="仅手动创建的任务可改")
    run_mode: Literal["night", "now"] | None = None


class DiscardRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class ArtifactOut(BaseModel):
    kind: str
    version: int
    source: str
    content: dict
    feedback: str | None
    created_at: datetime


class ReviewOut(BaseModel):
    stage: str
    action: str
    comment: str | None
    artifact_version: int | None
    created_at: datetime


class VideoInfo(BaseModel):
    task_id: str
    status: str
    video_url: str | None
    error_code: str | None
    error_message: str | None
    # 排队中（还没提交到 GPU）的任务在队列里的顺序，从 1 开始
    queue_position: int | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    # 已耗时（秒）：生成中为 started_at 至今，已结束为 started_at 至 completed_at
    elapsed_seconds: int | None = None
    # 夜间模式且窗口未开时，预计的开始提交时间
    expected_start_at: datetime | None = None


class ProductionListItem(BaseModel):
    id: str
    account_id: str
    account_name: str | None
    topic: str
    run_mode: str
    status: str
    needs_review: bool
    duration_seconds: int
    resolution: str
    created_at: datetime
    updated_at: datetime
    video: VideoInfo | None = None


class ProductionList(BaseModel):
    items: list[ProductionListItem]
    page: int
    page_size: int
    total: int


class ReferenceImage(BaseModel):
    file_id: str
    url: str


class ProductionDetail(ProductionListItem):
    seed: int | None
    failed_stage: str | None
    error_message: str | None
    allowed_actions: list[str]
    content: ArtifactOut | None
    history: list[ArtifactOut]
    reviews: list[ReviewOut]
    reference_images: list[ReferenceImage]
