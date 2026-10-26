"""运维接口（阶段 7）：指标与清理。"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.services.task_service import TaskService, get_task_service

router = APIRouter(prefix="/internal/v1/ops", tags=["ops"])


@router.get("/metrics")
async def metrics(service: TaskService = Depends(get_task_service)) -> dict:
    return service.metrics()


@router.post("/cleanup")
async def cleanup(days: int | None = None, service: TaskService = Depends(get_task_service)) -> dict:
    removed = service.cleanup_old_tasks(days)
    return {"removed": removed}
