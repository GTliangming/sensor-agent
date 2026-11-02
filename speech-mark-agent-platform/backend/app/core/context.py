"""请求级上下文：在异步链路中传递 request_id。

`ContextVar` 是 Python 为 async 场景提供的"线程安全版 ThreadLocal"：
每个请求（asyncio Task）拥有自己的副本，互不串扰，也不会像全局变量那样
在高并发下被覆盖。

典型用法（在中间件中成对调用）：

    token = set_request_id(request_id)
    try:
        ...                      # 处理请求，日志/下游调用均可读取 request_id
    finally:
        reset_request_id(token)  # 必须复位，避免污染复用同一 Context 的后续任务
"""

from contextvars import ContextVar, Token

# 当前请求的 ID；未经过中间件设置时（如启动期、后台线程）取默认值 "-"
_request_id: ContextVar[str] = ContextVar("request_id", default="-")


def set_request_id(value: str) -> Token[str]:
    """写入当前上下文的 request_id，返回用于复位的 token。

    注意：返回值不要丢弃，必须在处理结束后交给 `reset_request_id`，
    否则在 Task 复用或嵌套调用时可能残留上一条请求的值。
    """
    return _request_id.set(value)


def reset_request_id(token: Token[str]) -> None:
    """用 `set_request_id` 返回的 token 把上下文恢复到设置前的状态。

    基于 token 复位（而不是直接 set 回旧值），因此天然支持嵌套：
    内层 set/reset 不会破坏外层的值。
    """
    _request_id.reset(token)


def current_request_id() -> str:
    """读取当前上下文的 request_id，未设置时返回 "-"。"""
    return _request_id.get()
