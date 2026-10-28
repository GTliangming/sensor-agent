"""任务状态定义与状态机。

所有状态变更必须经过这里的规则校验，保证旧的轮询结果不会覆盖终态。
"""
from enum import StrEnum


class TaskStatus(StrEnum):
    PENDING = "pending"  # 已创建，等待 Worker 提交
    SUBMITTED = "submitted"  # 已提交给外部服务
    RUNNING = "running"  # 外部工作流执行中
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


TERMINAL_STATUSES = frozenset({TaskStatus.SUCCEEDED, TaskStatus.FAILED, TaskStatus.CANCELLED})
ACTIVE_STATUSES = frozenset({TaskStatus.PENDING, TaskStatus.SUBMITTED, TaskStatus.RUNNING})

# 常规流转。终态没有任何出边。
_ALLOWED: dict[TaskStatus, frozenset[TaskStatus]] = {
    TaskStatus.PENDING: frozenset({TaskStatus.SUBMITTED, TaskStatus.FAILED, TaskStatus.CANCELLED}),
    TaskStatus.SUBMITTED: frozenset(
        {TaskStatus.RUNNING, TaskStatus.SUCCEEDED, TaskStatus.FAILED, TaskStatus.CANCELLED}
    ),
    TaskStatus.RUNNING: frozenset({TaskStatus.SUCCEEDED, TaskStatus.FAILED, TaskStatus.CANCELLED}),
    TaskStatus.SUCCEEDED: frozenset(),
    TaskStatus.FAILED: frozenset(),
    TaskStatus.CANCELLED: frozenset(),
}


def can_transition(src: TaskStatus, dst: TaskStatus, *, is_retry: bool = False) -> bool:
    """是否允许 src -> dst。

    failed -> pending 是唯一的“逆向”边，只允许用户显式触发的重试使用
    （is_retry=True），轮询/Worker 路径永远不能走这条边。
    """
    if is_retry:
        return src == TaskStatus.FAILED and dst == TaskStatus.PENDING
    return dst in _ALLOWED[src]


# 这些错误码代表“重试也不会成功”，retry 接口直接拒绝
NON_RETRYABLE_ERROR_CODES = frozenset(
    {"PROVIDER_AUTH_FAILED", "PROVIDER_BAD_REQUEST", "VALIDATION_ERROR", "PROVIDER_NOT_CONFIGURED"}
)
# 提交结果不确定：外部任务可能已存在，重试可能重复扣费，需要用户明确确认
SUBMIT_UNCERTAIN_CODE = "SUBMIT_UNCERTAIN"
