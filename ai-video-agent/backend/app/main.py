"""应用入口：python -m uvicorn app.main:app"""
import asyncio
import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import accounts, files, health, productions, providers, templates, uploads, videos
from app.core.config import get_settings
from app.core.exceptions import AppError
from app.core.logging import setup_logging

logger = logging.getLogger(__name__)
API_PREFIX = "/api/v1"


def _start_embedded_worker() -> tuple[threading.Thread, asyncio.AbstractEventLoop, asyncio.Event]:
    """本地开发：在 API 进程内开一个线程跑 Worker（线上请改为独立进程 app.workers.runner）。"""
    from app.workers.runner import run_all

    loop = asyncio.new_event_loop()
    stop = asyncio.Event()

    def _run() -> None:
        asyncio.set_event_loop(loop)
        loop.run_until_complete(run_all(get_settings(), stop))

    thread = threading.Thread(target=_run, name="embedded-worker", daemon=True)
    thread.start()
    return thread, loop, stop


def _seed_defaults() -> None:
    """写入出厂数据（业务线、账号类型、生成配置、提示词模板）。幂等，已有的不覆盖。"""
    from app.db.session import SessionLocal
    from app.seed import ensure_defaults

    with SessionLocal() as db:
        ensure_defaults(db)


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    setup_logging(settings.log_level)
    if settings.auto_migrate:
        from app.db.migrate import upgrade_to_head

        upgrade_to_head()  # 建表失败要直接让服务起不来，而不是带着空库继续运行
    try:
        _seed_defaults()
    except Exception as e:
        raise RuntimeError("写入出厂数据失败：数据库表可能还没建，请执行 alembic upgrade head 或设置 AUTO_MIGRATE=true") from e
    handle = _start_embedded_worker() if settings.worker_embedded else None
    yield
    if handle:
        thread, loop, stop = handle
        loop.call_soon_threadsafe(stop.set)
        thread.join(timeout=5)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="AI Video Studio", version="0.1.0", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware, allow_origins=settings.cors_origin_list,
        allow_methods=["*"], allow_headers=["*"],
    )

    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            {"code": exc.code, "message": exc.message, "details": exc.details}, status_code=exc.http_status
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [{"field": ".".join(str(p) for p in e["loc"][1:]), "msg": e["msg"]} for e in exc.errors()]
        return JSONResponse(
            {"code": "VALIDATION_ERROR", "message": "请求参数不合法", "details": {"errors": errors}},
            status_code=422,
        )

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled error")  # 详情只进日志，不返回给客户端
        return JSONResponse({"code": "INTERNAL_ERROR", "message": "服务内部错误", "details": {}}, status_code=500)

    for module in (health, uploads, videos, providers, files, accounts, templates, productions):
        app.include_router(module.router, prefix=API_PREFIX)
    return app


app = create_app()
