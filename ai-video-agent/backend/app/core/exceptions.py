"""统一业务异常。路由层通过全局 handler 把它转成 {code, message, details} 响应。"""
from typing import Any


class AppError(Exception):
    """业务异常基类。code 是给前端/调用方判断用的稳定错误码。"""

    def __init__(
        self,
        code: str,
        message: str,
        http_status: int = 400,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status
        self.details = details or {}


class NotFoundError(AppError):
    def __init__(self, message: str = "资源不存在", details: dict[str, Any] | None = None) -> None:
        super().__init__("NOT_FOUND", message, 404, details)


class ValidationFailed(AppError):
    def __init__(self, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__("VALIDATION_ERROR", message, 422, details)


class StateConflict(AppError):
    """状态不允许当前操作（如对成功任务取消）。"""

    def __init__(self, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__("STATE_CONFLICT", message, 409, details)


class QuotaExceeded(AppError):
    def __init__(self, message: str) -> None:
        super().__init__("QUOTA_EXCEEDED", message, 429)


class ProviderError(Exception):
    """Provider 抛出的统一错误，由 Worker 决定如何落库/重试。

    retryable: 重试同一操作是否有意义（网络抖动等）。
    submit_uncertain: 仅提交阶段有意义。请求可能已被服务端接收（如读超时），
        此时盲目重提会重复扣费，必须交给人确认。
    """

    def __init__(
        self,
        code: str,
        message: str,
        *,
        retryable: bool = False,
        submit_uncertain: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.submit_uncertain = submit_uncertain
