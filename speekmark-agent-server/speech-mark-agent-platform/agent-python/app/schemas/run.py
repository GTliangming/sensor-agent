"""运行（Run）相关的 Pydantic 数据模型。

这些模型用于 FastAPI 接口层的请求/响应数据校验与序列化：
入参会被自动校验并转换为对应模型，出参会被序列化为 JSON。
"""

from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field

# 运行模式：快速 / 平衡 / 谨慎，用 Literal 限定取值范围。
RunMode = Literal["fast", "balanced", "careful"]
# 运行状态机：排队、运行中、成功、失败、取消、等待人工审批。
RunStatus = Literal["queued", "running", "succeeded", "failed", "cancelled", "waiting_approval"]


class CreateRunRequest(BaseModel):
    """创建运行的请求体。"""

    run_id: str | None = Field(default=None, min_length=3, max_length=64)  # 可选的自定义运行 ID，不传则由服务端生成
    input: str = Field(min_length=1, max_length=12_000)  # 用户输入内容，限制长度防止过大请求
    mode: RunMode = "balanced"  # 运行模式，默认平衡


class TraceEvent(BaseModel):
    """一条执行轨迹（Trace）事件，用于记录 Agent 运行过程中的单步动作。"""

    event_id: str  # 事件唯一 ID
    run_id: str  # 所属运行的 ID
    seq: int  # 事件序号，用于在同一次运行内排序
    type: str  # 事件类型（如节点执行、工具调用等）
    node: str  # 产生该事件的工作流节点名
    title: str  # 事件标题（简要描述）
    detail: str  # 事件详情
    status: str = "succeeded"  # 该步状态，默认成功
    duration_ms: int = 0  # 该步耗时（毫秒）
    tool_call_id: str | None = None  # 若为工具调用，对应的工具调用 ID
    input_summary: str | None = None  # 输入摘要（便于展示）
    output_summary: str | None = None  # 输出摘要（便于展示）
    created_at: datetime  # 事件创建时间


class RunResponse(BaseModel):
    """运行结果的响应体，聚合一次运行的输入、状态与统计信息。"""

    run_id: str  # 运行 ID
    input: str  # 原始输入
    status: RunStatus  # 当前运行状态
    final_answer: str | None = None  # 最终答案，成功时填充
    error: str | None = None  # 错误信息，失败时填充
    started_at: datetime  # 开始时间
    finished_at: datetime | None = None  # 结束时间，未结束时为空
    duration_ms: int = 0  # 总耗时（毫秒）
    steps: int = 0  # 执行步数统计
    tools: int = 0  # 工具调用次数统计
    tokens: int = 0  # 消耗的 token 数统计
