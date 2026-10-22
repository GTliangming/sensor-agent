"""LangGraph 工作流的共享状态定义。

LangGraph 以“状态图”的方式编排 Agent：各节点读取并更新同一份状态，
节点返回的字段会被合并回状态中，从而在节点之间传递数据。
"""

from typing import TypedDict


class AgentState(TypedDict, total=False):
    """节点间传递的状态结构。

    使用 TypedDict 约束状态的字段与类型；``total=False`` 表示所有字段
    均为可选，节点可按需只写入部分字段（如仅更新 answer 或 error）。
    """

    run_id: str  # 当前运行的唯一标识
    input: str  # 用户原始输入
    mode: str  # 运行模式（fast/balanced/careful）
    answer: str  # 最终生成的答案
    tool_summary: str  # 工具调用结果的汇总
    error: str  # 运行过程中产生的错误信息
