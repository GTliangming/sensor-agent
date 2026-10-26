"""确定性校验节点（见文档 03.3：这些环节必须由普通代码控制）。"""
from __future__ import annotations

from app.domain.errors import ErrorCode
from app.domain.request import CreateTaskRequest
from app.domain.storyboard import Storyboard
from app.graph.state import AgentState, Stage, TaskStatus
from app.observability.logging import get_logger

logger = get_logger(__name__)

# 分镜总时长允许偏离目标的比例
_DURATION_TOLERANCE = 0.35


async def validate_request(state: AgentState) -> dict:
    """输入边界与配额校验。失败即终止（不可重试输入错误）。"""
    try:
        CreateTaskRequest.model_validate(state["request"])
    except Exception as exc:  # noqa: BLE001 - 统一转成稳定错误码
        logger.warning("validate_request failed task=%s: %s", state["task_id"], exc)
        return {
            "status": TaskStatus.FAILED,
            "stage": Stage.VALIDATE_REQUEST,
            "errors": [{"code": str(ErrorCode.INVALID_INPUT), "message": str(exc)}],
        }
    return {"status": TaskStatus.RUNNING, "stage": Stage.VALIDATE_REQUEST}


async def validate_storyboard(state: AgentState) -> dict:
    """分镜业务级校验：结构已由 Pydantic 保证，这里校验配额与总时长。"""
    sb_dict = state.get("storyboard")
    if not sb_dict:
        return {
            "status": TaskStatus.FAILED,
            "stage": Stage.VALIDATE_STORYBOARD,
            "errors": [{"code": str(ErrorCode.MODEL_OUTPUT_INVALID), "message": "缺少 storyboard"}],
        }

    request = CreateTaskRequest.model_validate(state["request"])
    storyboard = Storyboard.model_validate(sb_dict)

    if len(storyboard.scenes) > request.max_scenes:
        return {
            "status": TaskStatus.FAILED,
            "stage": Stage.VALIDATE_STORYBOARD,
            "errors": [
                {
                    "code": str(ErrorCode.MODEL_OUTPUT_INVALID),
                    "message": f"场景数 {len(storyboard.scenes)} 超过 max_scenes={request.max_scenes}",
                }
            ],
        }

    target = request.target_seconds
    total = storyboard.total_duration
    if abs(total - target) > target * _DURATION_TOLERANCE:
        logger.info("storyboard 总时长 %.2fs 偏离目标 %ss，记录告警但不阻断", total, target)
        return {
            "stage": Stage.VALIDATE_STORYBOARD,
            "errors": [{"code": "duration_warning", "message": f"总时长 {total}s 偏离目标 {target}s"}],
        }

    return {"stage": Stage.VALIDATE_STORYBOARD}


async def validate_output(state: AgentState) -> dict:
    """产物校验（文档 08.3）。渲染通过 -> succeeded；产出但校验失败 -> failed。"""
    if state.get("status") == TaskStatus.FAILED:
        return {"stage": Stage.VALIDATING}

    render = state.get("render_plan")
    if render and render.get("validated"):
        return {"stage": Stage.VALIDATING, "status": TaskStatus.SUCCEEDED}
    if render and render.get("output_path"):
        return {
            "stage": Stage.VALIDATING,
            "status": TaskStatus.FAILED,
            "errors": [{"code": "output_invalid", "message": "渲染产物未通过 ffprobe 校验"}],
        }
    if state.get("storyboard"):
        # 未走到渲染（无音视频产物）仍可返回分镜就绪
        return {"stage": Stage.VALIDATING, "status": TaskStatus.STORYBOARD_READY}
    return {
        "stage": Stage.VALIDATING,
        "status": TaskStatus.FAILED,
        "errors": [{"code": str(ErrorCode.INTERNAL), "message": "无可校验产物"}],
    }
