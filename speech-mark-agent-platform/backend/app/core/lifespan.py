"""应用生命周期钩子：启动时初始化日志，关闭时留下停止日志。

单独成文件的理由：
- `main.py` 只保留「组装」逻辑，生命周期这类运行期行为放这里；
- 以后要加连接池、HTTP 客户端、缓存预热等资源管理，都在这一个 `lifespan`
  里成对地创建/释放（`yield` 之前创建、之后释放），不要散落到各模块。
"""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core.config import get_settings
from app.core.logging import setup_logging
from app.db.init_db import init_db

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """在 yield 前做启动初始化，yield 后做优雅关停。

    注意：日志必须在启动阶段配置好（而不是模块导入时），这样 uvicorn 的
    启动信息之后才会切换成项目统一的格式，也能按环境选择文本/JSON。
    """
    settings = get_settings()
    setup_logging(settings.log_level)

    # 初始化数据库
    await init_db()
    logger.info("database initialized", extra={"module_name": "lifespan"})


    logger.info(
        "app started",
        extra={"module_name": "lifespan", "app_env": settings.app_env},
    )
    try:
        yield
    finally:
        # 用 finally 保证即使启动后运行期抛异常，关停日志也不会丢
        logger.info("app stopped", extra={"module_name": "lifespan"})

