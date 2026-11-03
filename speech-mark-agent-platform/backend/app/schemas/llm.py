"""DeepSeek Chat Completions 响应模型。

只校验客户端需要的字段，其余字段忽略；供应商新增字段不会导致解析失败。
"""

from pydantic import BaseModel, ConfigDict, Field


class DeepSeekModel(BaseModel):
    model_config = ConfigDict(extra="ignore")


class DeepSeekMessage(DeepSeekModel):
    role: str = ""
    content: str | None = None


class DeepSeekChoice(DeepSeekModel):
    message: DeepSeekMessage


class DeepSeekUsage(DeepSeekModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0


class DeepSeekChatResponse(DeepSeekModel):
    model: str | None = None
    choices: list[DeepSeekChoice] = Field(default_factory=list)
    usage: DeepSeekUsage | None = None
