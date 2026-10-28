"""视频任务相关的请求/响应结构。注意：不暴露 provider_task_id、租约等内部字段。"""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class VideoCreateRequest(BaseModel):
    """手动生成：提示词原样提交，不经过大模型和审核。生成配置（视频方向、时长上限、seed 等）取自账号类型。"""

    account_id: str
    prompt: str = Field(min_length=1, max_length=20000, description="正向提示词，1-20000 个字符")
    negative_prompt: str | None = Field(default=None, max_length=2000)
    image_ids: list[str] = Field(default_factory=list, max_length=16, description="参考图片，先通过 /uploads 上传")
    resolution: str | None = Field(default=None, description="视频方向标签，如 480p竖；缺省取账号类型的默认项")
    duration_seconds: int | None = Field(default=None, description="缺省使用账号类型的默认时长")
    seed: int | None = Field(default=None, ge=0, description="缺省使用账号类型配置的 seed")
    # night：随时可以创建，后台等到夜间窗口才提交（默认，便宜）；now：立即提交
    run_mode: Literal["night", "now"] = "night"


class VideoTaskCreated(BaseModel):
    task_id: str
    status: str
    created_at: datetime


class VideoTaskListItem(BaseModel):
    task_id: str
    status: str
    prompt_preview: str
    aspect_ratio: str
    resolution: str | None = None
    duration_seconds: int
    created_at: datetime
    updated_at: datetime
    thumbnail_url: str | None = None
    video_url: str | None = None
    error_message: str | None = None
    schedule_mode: str = "now"
    queue_position: int | None = None
    # 夜间任务还在等窗口时，预计开始提交的时间
    expected_start_at: datetime | None = None


class VideoListData(BaseModel):
    items: list[VideoTaskListItem]
    page: int
    page_size: int
    total: int


class TaskEventOut(BaseModel):
    event_type: str
    from_status: str | None
    to_status: str | None
    message: str | None
    created_at: datetime


class VideoTaskDetail(BaseModel):
    task_id: str
    status: str
    prompt: str
    negative_prompt: str | None
    input_image_urls: list[str]
    aspect_ratio: str
    resolution: str | None
    seed: int | None
    duration_seconds: int
    queue_position: int | None
    workflow_key: str
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    error_code: str | None
    error_message: str | None
    retry_count: int
    can_retry: bool
    video_url: str | None
    schedule_mode: str
    expected_start_at: datetime | None
    events: list[TaskEventOut]


class VideoResult(BaseModel):
    task_id: str
    status: str
    video_url: str
    content_type: str | None
    size_bytes: int | None
    duration_seconds: int


class CancelResult(BaseModel):
    task_id: str
    status: str
    external_cancelled: bool
    note: str
