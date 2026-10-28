"""健康检查：存活与就绪分开，外部 GPU 服务的故障不影响这里。"""
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.db.session import get_db
from app.schemas.common import ok

router = APIRouter(tags=["health"])


@router.get("/health")
def liveness() -> dict:
    """存活检查：进程能响应即可。"""
    return ok({"status": "healthy"})


@router.get("/health/ready")
def readiness(db: Session = Depends(get_db)) -> dict:
    """就绪检查：数据库可用。"""
    try:
        db.execute(text("SELECT 1"))
    except Exception as e:
        raise AppError("NOT_READY", "数据库不可用", 503) from e
    return ok({"status": "ready"})
