"""FastAPI 应用入口（文档 00/09）。

本服务只负责 Python Agent 服务端：分镜、素材、补图、配音、图生视频、合成。
不负责登录、鉴权、权限、积分、支付、对外网关——这些在上游 Go 服务。
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import routes_health, routes_ops, routes_tasks
from app.config import get_settings
from app.observability.logging import get_logger, setup_logging
from app.services.task_service import get_task_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    setup_logging(settings.log_level)
    logger = get_logger("app")
    service = get_task_service()
    logger.info("manjian-agent 启动 env=%s graph=%s text=%s video=%s db=%s",
                settings.app_env, settings.graph_mode, settings.resolved_text_provider,
                settings.resolved_video_provider, settings.db_file)
    # 崩溃恢复：把残留的 running 任务重新入队并后台重跑
    if settings.recover_orphans_on_start:
        for task_id in service.recover_orphans():
            asyncio.create_task(service.run_task(task_id))
    yield
    logger.info("manjian-agent 关闭")


def create_app() -> FastAPI:
    app = FastAPI(
        title="漫剪师 Agent 服务端",
        version="0.1.0",
        description="单/多 Agent 视频生成链路：分镜→素材→补图→配音→图生视频→合成",
        lifespan=lifespan,
    )
    origins = [o.strip() for o in get_settings().cors_allow_origins.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"],
    )
    app.include_router(routes_health.router)
    app.include_router(routes_tasks.router)
    app.include_router(routes_ops.router)
    return app


app = create_app()
