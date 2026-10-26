"""任务 API（文档 09.1）。

- POST /internal/v1/tasks：创建任务，立即返回 task_id；后台异步执行。
- GET  /internal/v1/tasks/{task_id}：查询状态/阶段/结果/错误。
- POST /internal/v1/tasks/{task_id}/cancel：请求取消（协作式）。
接口仅面向受信任内部调用方；鉴权由系统边界保证，Python 仍校验请求体并限制资源。
"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import FileResponse

from app.api.schemas import CreateTaskRequest, CreateTaskResponse, TaskView
from app.services.task_service import TaskService, get_task_service

router = APIRouter(prefix="/internal/v1/tasks", tags=["tasks"])


@router.post("", response_model=CreateTaskResponse, status_code=202)
async def create_task(
    request: CreateTaskRequest,
    background: BackgroundTasks,
    service: TaskService = Depends(get_task_service),
) -> CreateTaskResponse:
    task, created = service.create_task(request)
    if created:
        background.add_task(service.run_task, task["task_id"])
    return CreateTaskResponse(task_id=task["task_id"], status=task["status"], created=created)


@router.get("/{task_id}", response_model=TaskView)
async def get_task(task_id: str, service: TaskService = Depends(get_task_service)) -> TaskView:
    task = service.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    return TaskView(**task)


@router.post("/{task_id}/cancel")
async def cancel_task(task_id: str, service: TaskService = Depends(get_task_service)) -> dict:
    if service.get_task(task_id) is None:
        raise HTTPException(status_code=404, detail="task not found")
    accepted = service.request_cancel(task_id)
    return {"task_id": task_id, "cancel_accepted": accepted}


@router.get("/{task_id}/runs")
async def task_runs(task_id: str, service: TaskService = Depends(get_task_service)) -> dict:
    if service.get_task(task_id) is None:
        raise HTTPException(status_code=404, detail="task not found")
    return {"task_id": task_id, "runs": service.list_agent_runs(task_id)}


@router.get("/{task_id}/video")
async def task_video(task_id: str, service: TaskService = Depends(get_task_service)) -> FileResponse:
    task = service.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    render = (task.get("result") or {}).get("render_plan") or {}
    path = render.get("output_path")
    if not path or not Path(path).exists():
        raise HTTPException(status_code=404, detail="video not ready")
    return FileResponse(path, media_type="video/mp4", filename=f"{task_id}.mp4")
