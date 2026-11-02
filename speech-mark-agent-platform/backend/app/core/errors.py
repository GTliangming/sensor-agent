"""统一异常处理：把各类异常转换成前端可消费的错误信封。

前端 `frontend/src/services/http.ts` 依赖这几个字段做展示与重试判断：
- `error.code`      稳定的机器可读错误码（分支、埋点、上报用）
- `error.message`   可直接展示给用户的中文文案（不要塞堆栈）
- `error.retryable` 用户能否点「重试」：限流/超时 True，参数错误 False
- `error.details`   可选的字段级明细（如表单逐项报错），前端按需渲染
- `meta.requestId`  与响应头 `X-Request-Id` 一致，用户报障时据此查日志

设计原则：错误响应与成功响应字段结构一致（`ok/data/meta/warnings/error`），
前端不需要用 `'data' in body` 这类判断来区分两种形态。
"""

import logging
from collections.abc import Mapping
from typing import Any, cast

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ExceptionHandler

from app.core.context import current_request_id
from app.core.error_catalog import (
    HTTP_ERROR_CODES,
    HTTP_ERROR_MESSAGES,
    VALIDATION_MESSAGES,
    ErrorCode,
)

logger = logging.getLogger(__name__)

# Starlette 内置的英文 detail，命中则换成 HTTP_ERROR_MESSAGES 里的中文文案。
# 这是「框架实现细节」，不属于对外契约，所以留在本模块而不放进 catalog。
_BUILTIN_DETAILS = {
    "Not Found",
    "Method Not Allowed",
    "Unauthorized",
    "Forbidden",
    "Internal Server Error",
}

# Pydantic 校验错误的 loc 前缀，对用户无意义，展示前去掉
_LOCATION_PREFIXES = {"body", "query", "path"}


class AppError(Exception):
    """业务错误:抛出后统一转成 {ok:false,error:{...}}。

    用法：`raise AppError("AGENT_USER_NOT_BOUND", "当前账号未绑定标注平台", status_code=403)`。
    status_code 决定 HTTP 状态码，code 决定前端分支逻辑，两者解耦但建议语义一致。
    """

    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = 400,
        retryable: bool = False,
        details: Any = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.retryable = retryable
        self.details = details


def _resolve_request_id(request: Request | None) -> str:
    """取当前请求 ID：优先 request.state，其次 ContextVar，最后 "-"。

    为什么优先 state：`Exception` 处理器由 ServerErrorMiddleware（最外层）执行，
    此时 RequestIdMiddleware 的 finally 已经复位了 ContextVar；而 state 存在
    `scope["state"]` 里，同一请求的任意 Request 实例都能读到，不会丢。
    """
    if request is not None:
        request_id = getattr(request.state, "request_id", None)
        if request_id:
            return str(request_id)
    return current_request_id()


def _error_response(
    request: Request | None,
    *,
    code: str,
    message: str,
    status_code: int,
    retryable: bool = False,
    details: Any = None,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    """构造统一错误响应；字段结构与成功信封保持一致。"""
    request_id = _resolve_request_id(request)

    error: dict[str, Any] = {
        "code": code,
        "message": message,
        "retryable": retryable,
    }
    if details is not None:
        # details 可能含 datetime/UUID/ORM 对象，统一编码成 JSON 友好结构
        error["details"] = jsonable_encoder(details)

    content: dict[str, Any] = {
        "ok": False,
        "data": None,
        "meta": {"requestId": request_id},
        "warnings": [],
        "error": error,
    }

    # 显式回写 X-Request-Id：500 走的是 ServerErrorMiddleware，响应不会经过
    # RequestIdMiddleware，靠这里兜底，前端/网关仍能拿到链路 ID
    response_headers = {"X-Request-Id": request_id}
    if headers:
        response_headers.update(headers)
    return JSONResponse(status_code=status_code, content=content, headers=response_headers)


async def _handle_app_error(request: Request, exc: AppError) -> JSONResponse:
    """业务异常：直接沿用异常自带的码、文案与重试语义。"""
    return _error_response(
        request,
        code=exc.code,
        message=exc.message,
        status_code=exc.status_code,
        retryable=exc.retryable,
        details=exc.details,
    )


def _split_http_detail(exc: StarletteHTTPException) -> tuple[str, Any]:
    """把 HTTPException.detail 拆成「可展示文案 + 可选明细」。

    detail 可能是 dict/list（例如自定义 404 带资源信息），直接 str() 会得到
    Python repr，前端展示很难看，因此这里分开处理。
    """
    if isinstance(exc.detail, str):
        if exc.detail in _BUILTIN_DETAILS or not exc.detail:
            return HTTP_ERROR_MESSAGES.get(exc.status_code, "请求失败"), None
        return exc.detail, None
    if exc.detail is None:
        return HTTP_ERROR_MESSAGES.get(exc.status_code, "请求失败"), None
    return HTTP_ERROR_MESSAGES.get(exc.status_code, "请求失败"), exc.detail


async def _handle_http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    """HTTPException（含 404/405 等框架内抛出的错误）。"""
    message, details = _split_http_detail(exc)
    return _error_response(
        request,
        code=HTTP_ERROR_CODES.get(exc.status_code, f"HTTP_{exc.status_code}"),
        message=message,
        status_code=exc.status_code,
        # 401 的 WWW-Authenticate 等头需要原样带回，否则浏览器/客户端行为会异常
        retryable=exc.status_code in (429, 503),
        details=details,
        headers=exc.headers,
    )


def _format_validation_errors(exc: RequestValidationError) -> tuple[str, list[dict[str, str]]]:
    """把 Pydantic 校验错误压成前端友好的「字段 + 中文原因」列表。"""
    items: list[dict[str, str]] = []
    for err in exc.errors():
        # loc 形如 ("body", "title")，去掉 body/query/path 前缀，保留可读路径
        location = [str(part) for part in err.get("loc", ()) if part not in _LOCATION_PREFIXES]
        field = ".".join(location) or "请求体"
        error_type = err.get("type", "")
        message = VALIDATION_MESSAGES.get(error_type, err.get("msg", "参数不合法"))
        items.append({"field": field, "message": message, "type": error_type})

    # 主文案拼前 3 条，够前端直接 toast；完整列表放 details 供表单逐项标红
    summary = "；".join(f"{item['field']} {item['message']}" for item in items[:3])
    if len(items) > 3:
        summary += f" 等 {len(items)} 处"
    return f"请求参数不合法：{summary}" if summary else "请求参数不合法", items


async def _handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    """请求体/参数校验失败：message 给人看，details 给表单逐项展示。"""
    message, details = _format_validation_errors(exc)
    return _error_response(
        request,
        code=ErrorCode.VALIDATION_ERROR,
        message=message,
        status_code=422,
        details=details,
    )


async def _handle_unexpected(request: Request, exc: Exception) -> JSONResponse:
    """兜底异常：日志留全量堆栈，响应只给安全文案，不泄露内部细节。"""
    request_id = _resolve_request_id(request)
    logger.exception(
        "unhandled error",
        extra={"request_id": request_id, "method": request.method, "path": request.url.path},
    )
    return _error_response(
        request,
        code=ErrorCode.INTERNAL_ERROR,
        message="服务内部错误，请稍后重试（如持续出现请提供 requestId 联系管理员）",
        status_code=500,
    )


def register_exception_handlers(app: FastAPI) -> None:
    """注册全部异常处理器；在 app 创建后、挂载路由前调用一次即可。

    注意 `Exception` 的处理器由 Starlette 的 ServerErrorMiddleware 执行，位于
    最外层，不会经过自定义中间件，所以错误响应需要自己回写 X-Request-Id。
    """
    # Starlette 把 handler 的参数类型统一写成了 `Exception`，这里用 cast 适配；
    # 实际调用时只会传入对应的异常子类，运行期没有额外判断成本
    handlers: list[tuple[type[Exception], ExceptionHandler]] = [
        (AppError, cast(ExceptionHandler, _handle_app_error)),
        (StarletteHTTPException, cast(ExceptionHandler, _handle_http_error)),
        (RequestValidationError, cast(ExceptionHandler, _handle_validation_error)),
        (Exception, cast(ExceptionHandler, _handle_unexpected)),
    ]
    for exc_type, handler in handlers:
        app.add_exception_handler(exc_type, handler)
