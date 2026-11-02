"""统一响应信封：所有接口返回 `{ok, data, meta, warnings, error}` 结构。

这样前端只需写一套解包逻辑：先看 `ok`，成功取 `data`，失败读 `error`；
`meta.requestId` 与请求头 `X-Request-Id` 一致，便于把前后端日志串起来排查。
"""

from datetime import datetime
from typing import Any

from app.schemas.base import APIModel

# 泛型参数 T（PEP 695 语法）：调用处写 Envelope[UserDTO]，即可把 data 约束成
# 具体 DTO，同时让 OpenAPI 生成精确的响应结构，而不是 any


class ErrorBody(APIModel):
    """失败时的错误描述（经 alias 机制对外输出为 camelCase）。"""

    code: str  # 稳定、机器可读的错误码，前端据此分支处理，不要随意改
    message: str  # 面向人的提示，可随文案调整
    retryable: bool = False  # 客户端能否原样重试：超时/限流为 True，参数错误为 False


class Meta(APIModel):
    """响应元信息，字段与前端 `frontend/src/types/index.ts` 的 `ApiMeta` 一一对应。"""

    # 由 RequestIdMiddleware 写入，未经过中间件（如测试、内部调用）时为 "-"
    request_id: str = "-"  # JSON: requestId
    # 数据抓取时间（Go 侧返回 fetched_at，ISO 8601，序列化后为字符串）
    fetched_at: datetime | None = None  # JSON: fetchedAt
    # 是否只拿到部分数据，例如工具自动翻页到上限仍有余量
    partial: bool = False  # JSON: partial
    # 分页游标；null 表示没有更多数据
    next_cursor: str | None = None  # JSON: nextCursor


class Envelope[T](APIModel):
    """成功/失败共用的外层包装，业务数据统一放在 data 里。"""

    ok: bool = True  # 业务是否成功；HTTP 状态码另由路由决定
    data: T | None = None  # 成功时的业务数据，失败时为 None
    meta: Meta = Meta()  # Pydantic 会为每个实例深拷贝默认值，不存在共享可变对象的坑
    warnings: list[str] = []  # 非致命提示（如部分数据缺失），不影响 ok
    error: ErrorBody | None = None  # 仅在 ok=False 时填充


def ok_envelope(
    data: Any,
    request_id: str,
    warnings: list[str] | None = None,
    *,
    fetched_at: datetime | None = None,
    partial: bool = False,
    next_cursor: str | None = None,
) -> dict[str, Any]:
    """快速构造成功响应的 dict，省去手写外层字段。

    meta 由 `Meta` 模型序列化（`by_alias=True`），因此字段名不会和
    `Envelope` 的模型路径出现漂移；分页类接口记得带上 `partial`/`next_cursor`。
    """
    meta = Meta(
        request_id=request_id,
        fetched_at=fetched_at,
        partial=partial,
        next_cursor=next_cursor,
    )
    return {
        "ok": True,
        "data": data,
        "meta": meta.model_dump(by_alias=True),
        "warnings": warnings or [],
    }
