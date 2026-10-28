"""业务线与账号类型相关结构。"""
from datetime import datetime

from pydantic import BaseModel, Field


class AccountTypeOut(BaseModel):
    id: str
    slug: str
    name: str
    platform: str
    persona: str
    style_guide: str | None
    workflow_key: str
    params: dict
    is_active: bool
    created_at: datetime


class BusinessLineOut(BaseModel):
    key: str
    name: str
    account_types: list[AccountTypeOut]


class AccountTypeCreate(BaseModel):
    platform: str
    slug: str = Field(min_length=1, max_length=32, pattern="^[a-z0-9_]+$")
    name: str = Field(min_length=1, max_length=64)
    persona: str = Field(min_length=1, max_length=2000)
    style_guide: str | None = Field(default=None, max_length=2000)
    workflow_key: str = "h3_reference_video"
    # 生成配置（见 domain/generation_config.py）。copy_from 给定且不传 params 时，沿用被复制类型的配置
    params: dict = Field(default_factory=dict)
    copy_from: str | None = Field(default=None, description="复制哪个账号类型的配置和专属模板")


class AccountTypeUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    persona: str = Field(min_length=1, max_length=2000)
    style_guide: str | None = Field(default=None, max_length=2000)
    # 生成配置：seed、视频方向、时长/图片上限、AutoDL 工作流 ID 和请求字段名等，保存前会校验
    params: dict = Field(default_factory=dict)
    is_active: bool = True


class SuggestTopicOut(BaseModel):
    topic: str
