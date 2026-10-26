"""终态定稿节点。

图保持"无外部副作用"：真正写数据库在 task_service；这里把 status 收敛到稳定终态。
"""
from __future__ import annotations

from app.graph.state import AgentState, Stage, TaskStatus
from app.observability.logging import get_logger

logger = get_logger(__name__)


async def save_result(state: AgentState) -> dict:
    status = state.get("status")
    if status == TaskStatus.FAILED:
        logger.info("task %s 失败定稿 stage=%s", state["task_id"], state.get("stage"))
        return {"stage": state.get("stage", Stage.DONE)}
    if status == TaskStatus.SUCCEEDED:
        logger.info("task %s 成功定稿（已出片）", state["task_id"])
        return {"status": TaskStatus.SUCCEEDED, "stage": Stage.DONE}
    # 仅完成到分镜（未出片）
    logger.info("task %s 分镜就绪", state["task_id"])
    return {"status": TaskStatus.STORYBOARD_READY, "stage": Stage.DONE}
