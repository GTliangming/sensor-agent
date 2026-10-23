"""FastAPI 生命周期（lifespan）钩子。

从应用入口 main.py 中抽离，集中管理服务启动/关闭时的资源初始化与释放逻辑，
例如连接池、模型客户端等的创建与清理。
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core.config import settings


@asynccontextmanager
async def lifespan(_: FastAPI):
    """FastAPI 生命周期钩子（lifespan）。

    `yield` 之前的代码在服务启动时执行一次，`yield` 之后的代码在服务关闭时执行，
    适合放置连接池初始化/释放等资源管理逻辑。这里仅在启动时打印一条当前运行模式日志，
    说明走的是 DeepSeek 在线模型还是本地确定性演示工作流。
    """
    logging.getLogger(__name__).info(
        "Agent 服务启动；模型模式=%s，模型=%s",
        "DeepSeek 在线模型" if settings.model_enabled else "确定性演示工作流",
        settings.deepseek_model if settings.model_enabled else "disabled",
    )
    yield
