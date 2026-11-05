"""Agent 对话相关的对外 DTO：会话（Thread）、消息、运行（Run）。

命名约定：对外用 LangGraph 的术语 Thread/Run；对应数据库里的
Conversation / AgentRun 模型。Field(...) 用来加校验（长度、默认值等）。
继承 APIModel，故对外字段自动 camelCase（created_at → createdAt）。
"""

from datetime import datetime

from pydantic import Field

from app.schemas.base import APIModel


class CreateThreadRequest(APIModel):
    """新建会话入参。"""

    # 标题可不传，默认「新会话」；最长 200，和 Conversation.title 的列宽一致
    title: str = Field(default="新会话", max_length=200)


class ThreadDTO(APIModel):
    """会话信息（对应 Conversation 模型）。"""

    id: str
    title: str
    created_at: datetime
    updated_at: datetime


class MessageDTO(APIModel):
    """单条消息（对应 Message 模型）。"""

    id: str
    role: str  # user / assistant / system
    content: str
    content_type: str = "text"  # 正文类型，默认纯文本
    created_at: datetime


class CreateRunRequest(APIModel):
    """发起一次 Agent 运行的入参。"""

    # 用户本轮的问题文本；1~8000 字，空串会被拒绝
    message: str = Field(min_length=1, max_length=8000)
    mode: str = "read_only"  # 运行模式；第一阶段严格只读


class RunDTO(APIModel):
    """一次 Agent 运行的结果（对应 AgentRun 模型）。"""

    id: str
    thread_id: str
    status: str  # queued / running / succeeded / failed
    question: str
    answer: str | None = None  # 执行中/失败时为空
    created_at: datetime