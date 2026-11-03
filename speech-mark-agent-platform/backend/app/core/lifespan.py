"""应用生命周期钩子：启动时初始化日志、数据库和共享客户端，关闭时释放资源。

单独成文件的理由：
- `main.py` 只保留「组装」逻辑，生命周期这类运行期行为放这里；
- 需要成对创建/释放的资源（数据库、HTTP 客户端、缓存）都在这里管理，
  不要散落到各模块。
"""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core.config import get_settings
from app.core.logging import setup_logging
from app.db.init_db import init_db
from app.integrations.llm.client import DeepSeekClient

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """在 yield 前做启动初始化，yield 后做优雅关停。"""
    settings = get_settings()
    setup_logging(settings.log_level)

    # 初始化数据库
    await init_db()
    logger.info("database initialized", extra={"module_name": "lifespan"})

    # LLM 客户端复用一个连接池；未配置 API Key 时仍可创建，真正调用时再报错
    llm_client = DeepSeekClient()
    app.state.llm_client = llm_client
    logger.info("llm client initialized", extra={"module_name": "lifespan"})

    logger.info(
        "app started",
        extra={"module_name": "lifespan", "app_env": settings.app_env},
    )
    try:
        yield
    finally:
        await llm_client.aclose()
        logger.info("app stopped", extra={"module_name": "lifespan"})
