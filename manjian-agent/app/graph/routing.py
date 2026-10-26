"""路由决策（文档 04.2 / 05.4）。

当前单图只需要"继续 / 失败"两种分支；RouteDecision 预留给后续多 Agent 的
Supervisor 有限路由。Supervisor 只能返回枚举，绝不生成任意 Python / shell / 节点名。
"""
from __future__ import annotations

from enum import StrEnum

from app.graph.state import AgentState, TaskStatus


class RouteDecision(StrEnum):
    """供未来 Supervisor 使用的白名单动作（见文档 05.4）。"""

    CONTINUE = "continue"
    REVISE_STORYBOARD = "revise_storyboard"
    RETRY_ASSET_SEARCH = "retry_asset_search"
    GENERATE_MISSING_IMAGES = "generate_missing_images"
    FAIL = "fail"


def continue_or_fail(state: AgentState) -> str:
    """单图分支：任一关键节点把 status 置为 failed 时，直接跳到持久化失败。"""
    return "fail" if state.get("status") == TaskStatus.FAILED else "continue"
