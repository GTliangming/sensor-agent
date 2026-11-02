"""系统健康检查：供负载均衡 / K8s probe 以及前端联调时自检使用。

该接口刻意保持轻量：不查数据库、不调外部依赖，只反映「进程是否活着」。
后续若要接 readiness（数据库、LLM、业务侧 API 连通性），建议另开
`/health/ready`，避免把探活接口变成慢接口。
"""

from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter

from app.core.config import get_settings
from app.core.context import current_request_id
from app.schemas.base import APIModel
from app.schemas.common import Envelope, Meta

router = APIRouter(tags=["system"])


class HealthData(APIModel):
    """健康检查返回体；对外字段为 status / appEnv / version / serverTime。"""

    # Literal 让 OpenAPI 直接给出枚举，前端可据此收敛类型；
    # 预留 degraded：依赖异常但进程仍可服务时可降级返回
    status: Literal["ok", "degraded"]
    app_env: str  # development / test / production
    version: str  # 与 OpenAPI 文档的 version 同源（settings.app_version）
    # 用 datetime 而非 str：由 Pydantic 统一序列化成带时区的 ISO 8601（UTC 会输出 Z）
    server_time: datetime


@router.get("/health", summary="健康检查")
async def health() -> Envelope[HealthData]:
    """返回进程存活状态与构建信息，响应始终包在统一信封里。

    调用方（K8s / 网关）通常只关心 HTTP 200；前端联调时可借此确认
    自己连的是哪个环境、哪个版本，以及服务端时间是否正常。
    """
    settings = get_settings()
    return Envelope[HealthData](
        data=HealthData(
            status="ok",
            app_env=settings.app_env,
            version=settings.app_version,
            server_time=datetime.now(UTC),
        ),
        meta=Meta(request_id=current_request_id()),
    )
