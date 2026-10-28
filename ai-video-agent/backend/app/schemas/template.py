"""提示词模板相关结构。"""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

TemplateKind = Literal[
    "content", "content_user", "topic_suggest", "video_base", "video_character", "video_shot", "video_dialogue",
    "video_negative", "video_negative_line",
]


class TemplateCreate(BaseModel):
    kind: TemplateKind
    name: str = Field(min_length=1, max_length=64)
    body: str = Field(max_length=8000, description="可用 {{变量}}，变量列表见 /templates/meta；角色设定可以留空")
    # 作用域：account_id 有值 = 该账号类型专属；只有 platform = 该业务线通用；都空 = 全局通用
    account_id: str | None = None
    video_type: str | None = None
    platform: str | None = None


class TemplateUpdate(BaseModel):
    """修改会生成新版本，旧版本保留。"""

    name: str = Field(min_length=1, max_length=64)
    body: str = Field(max_length=8000)
    account_id: str | None = None
    video_type: str | None = None
    platform: str | None = None


class TemplateOut(BaseModel):
    id: str
    group_id: str
    version: int
    kind: str
    name: str
    account_id: str | None
    video_type: str | None
    platform: str | None
    body: str
    is_active: bool
    created_at: datetime


class TemplateMeta(BaseModel):
    variables: dict[str, str]
    kinds: dict[str, str]  # kind -> 中文名
    required: list[str]  # 缺了就不能生成的种类
    starters: dict[str, str]  # kind -> 起步文本（仅供编辑器参考，运行时不读取）
