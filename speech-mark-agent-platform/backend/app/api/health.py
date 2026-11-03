"""系统健康检查。

- `/health`：进程存活探针，保持轻量，不查数据库、不调外部依赖；
- `/health/ready`：就绪探针，检查数据库连通性和 LLM 配置是否到位。
"""

import logging
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.context import current_request_id
from app.db.session import get_db
from app.schemas.base import APIModel
from app.schemas.common import Envelope, Meta

logger = logging.getLogger(__name__)

router = APIRouter(tags=["system"])


class HealthData(APIModel):
    """健康检查返回体；对外字段为 status / appEnv / version / serverTime。"""

    status: Literal["ok", "degraded"]
    app_env: str
    version: str
    server_time: datetime


class ReadyChecks(APIModel):
    """就绪检查的各个依赖项。"""

    database: Literal["ok", "error"]
    llm: Literal["configured", "not_configured"]


class ReadyData(APIModel):
    status: Literal["ok", "degraded"]
    checks: ReadyChecks


@router.get("/health", summary="健康检查")
async def health() -> Envelope[HealthData]:
    """返回进程存活状态与构建信息，响应始终包在统一信封里。"""
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


@router.get("/health/ready", summary="就绪检查")
async def readiness(
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> Envelope[ReadyData]:
    """检查数据库连通性与 LLM 配置；未就绪时返回 HTTP 503。"""
    settings = get_settings()

    database_status: Literal["ok", "error"] = "ok"
    try:
        await db.execute(text("SELECT 1"))
    except Exception:
        logger.exception("readiness database check failed")
        database_status = "error"

    llm_status: Literal["configured", "not_configured"] = (
        "configured" if settings.deepseek_api_key else "not_configured"
    )

    ready = database_status == "ok" and llm_status == "configured"
    response.status_code = 200 if ready else 503

    return Envelope[ReadyData](
        data=ReadyData(
            status="ok" if ready else "degraded",
            checks=ReadyChecks(database=database_status, llm=llm_status),
        ),
        meta=Meta(request_id=current_request_id()),
    )
