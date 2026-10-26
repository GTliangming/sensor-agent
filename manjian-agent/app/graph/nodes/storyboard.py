"""分镜生成节点（文档 03 / 阶段 1 的核心可运行环节）。

节点负责：构建提示词 -> 调用 provider -> Pydantic 校验 -> 非法最多重试 N 次。
预算（最大重试次数）由普通代码强制，模型不能自行决定是否超预算。
"""
from __future__ import annotations

import time

from app.config import Settings
from app.domain.errors import DomainError, ErrorCode
from app.domain.request import CreateTaskRequest
from app.domain.storyboard import Storyboard
from app.graph.state import AgentState, Stage, TaskStatus
from app.observability.logging import get_logger
from app.providers.text.base import TextProvider
from app.repositories.sqlite import TaskRepository

logger = get_logger(__name__)


def make_generate_storyboard(provider: TextProvider, settings: Settings,
                             repo: TaskRepository | None = None):
    max_attempts = max(1, settings.max_retry_per_step + 1)

    def _record(task_id: str, status: str, calls: int, t0: float) -> None:
        if repo is not None:
            repo.add_agent_run(task_id, "storyboard", model_name=provider.name, status=status,
                               latency_ms=int((time.perf_counter() - t0) * 1000),
                               usage={"attempts": calls})

    async def generate_storyboard(state: AgentState) -> dict:
        t0 = time.perf_counter()
        request = CreateTaskRequest.model_validate(state["request"])
        # HITL 返工意见：人工点"打回重生成"时带进提示词，引导模型按意见调整
        feedback = state.get("review_feedback") or None
        # 预算强制（文档 01）：跨"返工"累计的 LLM 调用数不得超过 max_llm_calls
        used = state.get("llm_calls", 0)
        if used >= settings.max_llm_calls:
            return {
                "stage": Stage.STORYBOARDING,
                "status": TaskStatus.FAILED,
                "errors": [{"code": str(ErrorCode.RESOURCE_LIMIT),
                            "message": f"LLM 调用预算耗尽（已用 {used}/{settings.max_llm_calls}）"}],
            }
        budget_left = settings.max_llm_calls - used
        attempts_allowed = max(1, min(max_attempts, budget_left))
        last_error: str | None = None
        calls = 0

        for attempt in range(1, attempts_allowed + 1):
            calls += 1
            try:
                raw = await provider.generate_storyboard(request, attempt=attempt, feedback=feedback)
                storyboard = Storyboard.model_validate(raw)
                logger.info(
                    "storyboard ok task=%s provider=%s attempt=%s scenes=%s total=%.2fs",
                    state["task_id"], provider.name, attempt,
                    len(storyboard.scenes), storyboard.total_duration,
                )
                _record(state["task_id"], "ok", calls, t0)
                return {
                    "stage": Stage.STORYBOARDING,
                    "storyboard": storyboard.model_dump(),
                    "llm_calls": calls,
                }
            except DomainError as exc:
                last_error = exc.message
                logger.warning("storyboard DomainError attempt=%s: %s", attempt, exc.message)
                if not exc.retryable:
                    break
            except Exception as exc:  # noqa: BLE001 - 校验失败等，重试
                last_error = str(exc)
                logger.warning("storyboard invalid attempt=%s: %s", attempt, exc)

        _record(state["task_id"], "failed", calls, t0)
        return {
            "stage": Stage.STORYBOARDING,
            "status": TaskStatus.FAILED,
            "llm_calls": calls,
            "errors": [
                {
                    "code": str(ErrorCode.MODEL_OUTPUT_INVALID),
                    "message": f"分镜生成在 {calls} 次尝试后仍失败: {last_error}",
                }
            ],
        }

    return generate_storyboard
