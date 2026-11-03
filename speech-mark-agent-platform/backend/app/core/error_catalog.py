"""错误码与默认提示文案：前后端共享的稳定契约。

单独成文件的原因：

1. 路由、工具层、中间件都会 `raise AppError(ErrorCode.XXX, ...)`，集中登记
   可以避免错误码拼写漂移（`RATE_LIMITED` vs `RATE_LIMIT`）；
2. 默认文案统一维护，改文案不需要翻异常处理器；
3. 后续可以由这份清单生成前端 TS 常量或接口文档中的错误码表。

注意：这里的取值属于**对外契约**，新增可以，重命名/删除等同于接口变更，
必须同步前端 `src/services/http.ts` 的分支逻辑与 docs 中的错误码说明。
"""

from enum import StrEnum


class ErrorCode(StrEnum):
    """框架层错误码；业务错误码（如 AGENT_USER_NOT_BOUND）后续也在此登记。"""

    BAD_REQUEST = "BAD_REQUEST"
    UNAUTHORIZED = "UNAUTHORIZED"
    FORBIDDEN = "FORBIDDEN"
    NOT_FOUND = "NOT_FOUND"
    METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED"
    CONFLICT = "CONFLICT"
    RATE_LIMITED = "RATE_LIMITED"
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    INTERNAL_ERROR = "INTERNAL_ERROR"

    AUTH_INVALID_CREDENTIALS = "AUTH_INVALID_CREDENTIALS"
    AUTH_USER_DISABLED = "AUTH_USER_DISABLED"
    AUTH_TOKEN_INVALID = "AUTH_TOKEN_INVALID"
    AUTH_TOKEN_EXPIRED = "AUTH_TOKEN_EXPIRED"

    LLM_NOT_CONFIGURED = "LLM_NOT_CONFIGURED"
    LLM_TIMEOUT = "LLM_TIMEOUT"
    LLM_RATE_LIMITED = "LLM_RATE_LIMITED"
    LLM_UPSTREAM_ERROR = "LLM_UPSTREAM_ERROR"


# HTTP 状态码 → 错误码。未登记的状态码会退化成 `HTTP_<status>`。
HTTP_ERROR_CODES: dict[int, ErrorCode] = {
    400: ErrorCode.BAD_REQUEST,
    401: ErrorCode.UNAUTHORIZED,
    403: ErrorCode.FORBIDDEN,
    404: ErrorCode.NOT_FOUND,
    405: ErrorCode.METHOD_NOT_ALLOWED,
    409: ErrorCode.CONFLICT,
    429: ErrorCode.RATE_LIMITED,
    503: ErrorCode.SERVICE_UNAVAILABLE,
}

# HTTP 状态码 → 默认中文提示。仅当异常没有给出可读 detail 时使用，
# 避免把 Starlette 的 "Not Found" 这类英文原文直接抛给用户。
HTTP_ERROR_MESSAGES: dict[int, str] = {
    400: "请求参数不合法",
    401: "登录状态已失效，请重新登录",
    403: "没有权限访问该资源",
    404: "请求的资源不存在",
    405: "请求方法不支持",
    409: "资源状态冲突，请刷新后重试",
    429: "请求过于频繁，请稍后重试",
    503: "服务暂时不可用，请稍后重试",
}

# Pydantic 校验错误类型 → 更直白的中文提示（未命中时保留 Pydantic 原文）。
# 键来自 pydantic-core 的 error type，新增字段类型时可按需补充。
VALIDATION_MESSAGES: dict[str, str] = {
    "missing": "不能为空",
    "string_type": "必须是字符串",
    "int_type": "必须是整数",
    "int_parsing": "必须是整数",
    "float_type": "必须是数字",
    "float_parsing": "必须是数字",
    "bool_type": "必须是布尔值",
    "bool_parsing": "必须是布尔值",
    "list_type": "必须是数组",
    "dict_type": "必须是对象",
    "greater_than": "取值过小",
    "less_than": "取值过大",
}
