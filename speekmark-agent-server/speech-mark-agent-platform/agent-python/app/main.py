import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import router
from app.core.config import settings

logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO), format="%(asctime)s %(levelname)s %(name)s %(message)s")

@asynccontextmanager
async def lifespan(_: FastAPI):
    logging.getLogger(__name__).info(
        "Agent 服务启动；模型模式=%s，模型=%s",
        "DeepSeek 在线模型" if settings.model_enabled else "确定性演示工作流",
        settings.deepseek_model if settings.model_enabled else "disabled",
    )
    yield

app = FastAPI(title=settings.app_name, version="0.1.0", description="面向语音标注业务的 Agent API 骨架", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_credentials=False, allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["*"])
app.include_router(router)

@app.get("/health/live", tags=["健康检查"])
def liveness() -> dict:
    return {"status": "alive", "service": "agent-python"}

@app.get("/health/ready", tags=["健康检查"])
def readiness() -> dict:
    # 此接口只报告进程配置，不主动发起会产生费用的模型请求。
    return {"status": "ready", "model_enabled": settings.model_enabled}
