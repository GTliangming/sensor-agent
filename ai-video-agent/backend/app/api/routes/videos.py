"""视频任务接口。路由层只做参数接收与响应包装，业务都在 VideoService。"""
from datetime import datetime

from fastapi import APIRouter, Depends, Header, Query, Response

from app.api.deps import get_video_service
from app.domain.status import TaskStatus
from app.schemas.common import ApiResponse, ok
from app.schemas.video import (
    CancelResult, VideoCreateRequest, VideoListData, VideoResult, VideoTaskCreated, VideoTaskDetail,
)
from app.services.video_service import VideoService

router = APIRouter(prefix="/videos", tags=["videos"])


@router.post("", response_model=ApiResponse[VideoTaskCreated], status_code=202)
def create_video(
    body: VideoCreateRequest,
    response: Response,
    idempotency_key: str | None = Header(default=None, max_length=128),
    svc: VideoService = Depends(get_video_service),
) -> dict:
    """创建任务并立即返回 task_id（202 表示已受理，不代表已生成）。

    带上 Idempotency-Key 头可防止重复点击/网络重试造成重复生成。
    """
    task, created = svc.create(body, idempotency_key)
    return ok(
        VideoTaskCreated(task_id=task.id, status=task.status, created_at=task.created_at),
        "任务已创建" if created else "任务已存在（幂等命中）",
    )


@router.get("", response_model=ApiResponse[VideoListData])
def list_videos(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: TaskStatus | None = None,
    created_after: datetime | None = None,
    created_before: datetime | None = None,
    svc: VideoService = Depends(get_video_service),
) -> dict:
    return ok(svc.list_page(
        page=page, page_size=page_size, status=status.value if status else None,
        created_after=created_after, created_before=created_before,
    ))


@router.get("/{task_id}", response_model=ApiResponse[VideoTaskDetail])
def get_video(task_id: str, svc: VideoService = Depends(get_video_service)) -> dict:
    return ok(svc.detail(task_id))


@router.get("/{task_id}/result", response_model=ApiResponse[VideoResult])
def get_result(task_id: str, svc: VideoService = Depends(get_video_service)) -> dict:
    return ok(svc.result(task_id))


@router.post("/{task_id}/retry", response_model=ApiResponse[VideoTaskCreated], status_code=202)
def retry_video(
    task_id: str,
    confirm_duplicate: bool = Query(False, description="上次提交结果不确定时，确认接受重复生成的费用"),
    svc: VideoService = Depends(get_video_service),
) -> dict:
    task = svc.retry(task_id, confirm_duplicate)
    return ok(VideoTaskCreated(task_id=task.id, status=task.status, created_at=task.created_at), "已加入重试")


@router.post("/{task_id}/cancel", response_model=ApiResponse[CancelResult])
def cancel_video(task_id: str, svc: VideoService = Depends(get_video_service)) -> dict:
    return ok(svc.cancel(task_id))
