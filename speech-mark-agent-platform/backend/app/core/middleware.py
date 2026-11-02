"""请求链路中间件：注入 request_id、记录访问日志。

request_id 存放在 contextvars（见 `app.core.context`），不需要层层传参：
视图函数可用 `request.state.request_id`，其余代码（工具函数、仓储层、
日志过滤器）直接调 `current_request_id()` 即可拿到当前请求的 ID。
"""

import logging
import time
import uuid

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.core.config import Settings
from app.core.context import reset_request_id, set_request_id

REQUEST_ID_HEADER = "X-Request-Id"

# 上游传来的 ID 做长度截断，避免超长 header 把日志撑爆
_MAX_REQUEST_ID_LENGTH = 64

# 高频探活路径：访问日志降到 DEBUG，避免 K8s / 负载均衡轮询把 INFO 日志刷满。
# 仍然记录（便于排查），只是默认 INFO 级别下不可见；需要时按路径精确匹配，
# 若以后有 /api/health/live、/api/health/ready，记得一并加进来。
SILENT_ACCESS_LOG_PATHS = frozenset({"/api/health"})

logger = logging.getLogger(__name__)


def _resolve_request_id(request: Request) -> str:
    """优先复用上游（网关 / 前端 / 内部调用）传来的 ID，没有则新生成。

    用 `uuid4().hex` 而不是 `str(uuid4())`：32 位无连字符，更短、更好 grep。
    """
    incoming = request.headers.get(REQUEST_ID_HEADER, "").strip()
    if incoming:
        return incoming[:_MAX_REQUEST_ID_LENGTH]
    return f"req_{uuid.uuid4().hex}"


class RequestIdMiddleware(BaseHTTPMiddleware):
    """为每个 HTTP 请求确定 request_id，写入上下文并回写到响应头。"""

    # 不重写 __init__：BaseHTTPMiddleware 已经保存了 app，交给父类即可

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = _resolve_request_id(request)

        # 双写：state 给视图层用，ContextVar 给异步链路里的其他代码用
        request.state.request_id = request_id
        token = set_request_id(request_id)

        started = time.perf_counter()
        # 未进入响应阶段就抛异常时没有 status_code，按 500 记录
        status_code = 500

        try:
            response = await call_next(request)
            status_code = response.status_code
            response.headers[REQUEST_ID_HEADER] = request_id
            return response
        except Exception:
            # logger.exception 自带 traceback，排查 5xx 主要靠这条
            logger.exception(
                "request failed",
                extra={
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                },
            )
            raise
        finally:
            # 访问日志放在 finally：成功、失败都能记到耗时，且只写一处。
            # 探活路径降到 DEBUG，避免轮询刷屏但仍保留排查能力
            log_access = (
                logger.debug
                if request.url.path in SILENT_ACCESS_LOG_PATHS
                else logger.info
            )
            log_access(
                "request completed",
                extra={
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "status_code": status_code,
                    "latency_ms": int((time.perf_counter() - started) * 1000),
                },
            )
            # 必须复位：ASGI 服务器会复用 Task，残留值会串到后续请求上
            reset_request_id(token)


def setup_middlewares(app: FastAPI, settings: Settings) -> None:
    """注册全局中间件，main.py 不再直接关心每个中间件的参数。

    顺序即洋葱模型：Starlette 后添加的中间件位于外层。这里先加 CORS、
    后加 RequestId，使 RequestId 处于最外层，保证 CORS 预检等提前返回的
    响应也能带上 X-Request-Id。
    """
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        # 让浏览器端 JS 能读到这个响应头（默认只暴露少数安全头）
        expose_headers=[REQUEST_ID_HEADER],
    )
    app.add_middleware(RequestIdMiddleware)
