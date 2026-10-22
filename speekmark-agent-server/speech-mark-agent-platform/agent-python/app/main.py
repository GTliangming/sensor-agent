"""FastAPI 应用入口：装配 ASGI 应用、CORS 中间件、业务路由与健康检查接口。

这是整个 Agent 服务的启动模块，`uvicorn app.main:app` 会加载此处创建的 `app` 实例。
"""

import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import router
from app.core.config import settings

# 以配置项中的日志级别初始化根 logger；无效级别时回退为 INFO。
logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO), format="%(asctime)s %(levelname)s %(name)s %(message)s")

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

# 创建 ASGI 应用实例；title/version/description 会直接体现在自动生成的 OpenAPI 文档（/docs）中。
app = FastAPI(title=settings.app_name, version="0.1.0", description="面向语音标注业务的 Agent API 骨架", lifespan=lifespan)
# 注册 CORS 中间件，仅放行本地前端（Vite 默认端口 5173）的跨域调用，并限定可用的 HTTP 方法。
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_credentials=False, allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["*"])
# 挂载业务路由（/v1 下的 runs 相关接口），使其成为应用的一部分。
app.include_router(router)

@app.get("/health/live", tags=["健康检查"])
def liveness() -> dict:
    """存活探针（liveness）：只要进程能响应就返回 alive，供 K8s 等编排系统判断是否需要重启容器。"""
    return {"status": "alive", "service": "agent-python"}

@app.get("/health/ready", tags=["健康检查"])
def readiness() -> dict:
    """就绪探针（readiness）：报告进程是否已准备好对外提供服务。"""
    # 此接口只报告进程配置，不主动发起会产生费用的模型请求。
    return {"status": "ready", "model_enabled": settings.model_enabled}
