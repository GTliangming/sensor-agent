"""Provider 抽象：业务层只依赖这里的接口，不关心具体服务商。"""
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from app.domain.generation_config import GenerationConfig
from app.domain.status import TaskStatus


@dataclass
class ImagePart:
    """一张参考图。bytes 用于内联（base64）方式，url 用于 AUTODL_IMAGE_MODE=url。"""

    data: bytes
    content_type: str
    url: str | None = None


@dataclass
class SubmitRequest:
    """提交给 Provider 的、与服务商无关的任务描述。"""

    request_token: str  # 本系统生成的请求标识，用于排查/对账
    workflow_key: str
    prompt: str
    negative_prompt: str | None
    aspect_ratio: str
    duration_seconds: int
    resolution: str | None = None  # 视频方向标签，如 480p竖
    seed: int | None = None
    dialogue: str | None = None  # 视频里的台词，AutoDL 接口支持带台词生成
    images: list[ImagePart] = field(default_factory=list)
    # 账号类型的生成配置（工作流 ID、请求字段名），生成时从数据库取出
    config: GenerationConfig | None = None


@dataclass
class ProviderStatus:
    """Provider 状态统一结构。status 只会是 RUNNING / SUCCEEDED / FAILED 之一。"""

    status: TaskStatus
    progress: float | None = None
    video_url: str | None = None
    error_code: str | None = None
    error_message: str | None = None


class VideoProvider(Protocol):
    name: str

    async def submit(self, req: SubmitRequest) -> str:
        """提交工作流，返回外部任务 ID。"""
        ...

    async def get_status(self, provider_task_id: str) -> ProviderStatus:
        """查询状态并转换为内部统一结构。"""
        ...

    async def download_result(self, status: ProviderStatus, dest: Path, max_bytes: int) -> str:
        """把生成的视频下载到 dest，返回 content_type。"""
        ...

    async def ping(self) -> dict:
        """配置与连通性自检（只读，不能触发生成）。"""
        ...
