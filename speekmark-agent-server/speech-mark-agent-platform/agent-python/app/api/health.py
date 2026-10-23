"""健康检查相关的 HTTP 路由定义。

将存活/就绪探针从应用入口 main.py 中抽离，作为一组独立路由，
由 main.py 统一挂载，保持入口文件只负责应用装配。
"""

from fastapi import APIRouter
from app.core.config import settings

# 健康检查路由集合；tags 用于 OpenAPI 文档分组。
router = APIRouter(tags=["健康检查"])


@router.get("/health/live")
def liveness() -> dict:
    """存活探针（liveness）：只要进程能响应就返回 alive，供 K8s 等编排系统判断是否需要重启容器。"""
    return {"status": "alive", "service": "agent-python"}


@router.get("/health/ready")
def readiness() -> dict:
    """就绪探针（readiness）：报告进程是否已准备好对外提供服务。"""
    # 此接口只报告进程配置，不主动发起会产生费用的模型请求。
    return {"status": "ready", "model_enabled": settings.model_enabled}
