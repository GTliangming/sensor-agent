"""领域错误与稳定错误码（见文档 10 章错误分类）。

每个阶段失败都应有稳定错误码，便于上游定位与统计。
"""
from __future__ import annotations

from enum import StrEnum


class ErrorCode(StrEnum):
    # 不可重试的输入错误
    INVALID_INPUT = "invalid_input"
    # 模型输出错误（JSON 不可解析 / Schema 不通过）
    MODEL_OUTPUT_INVALID = "model_output_invalid"
    # 可重试的供应商错误（429 / 5xx / 临时网络）
    PROVIDER_RETRYABLE = "provider_retryable"
    # 业务不可继续
    BUSINESS_BLOCKED = "business_blocked"
    # 资源限制（超时 / 预算耗尽）
    RESOURCE_LIMIT = "resource_limit"
    # 未实现（阶段 0-1 之后的能力桩）
    NOT_IMPLEMENTED = "not_implemented"
    # 内部错误
    INTERNAL = "internal"


class DomainError(Exception):
    """带稳定错误码的领域异常。"""

    def __init__(self, code: ErrorCode, message: str, *, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable

    def to_dict(self) -> dict:
        return {"code": str(self.code), "message": self.message, "retryable": self.retryable}
