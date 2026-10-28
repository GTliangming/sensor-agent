"""生产流程接口：创建 + 三个审核点上的人工操作。每个操作都立即返回最新详情。"""
from fastapi import APIRouter, Depends, Query

from app.api.deps import get_production_service
from app.domain.production_status import ProductionStatus
from app.schemas.common import ApiResponse, ok
from app.schemas.production import (
    ApproveDialogueRequest, ApproveSceneRequest, DiscardRequest, ProductionCreate, ProductionDetail,
    ProductionList, RegenerateRequest, RegenerateVideoRequest,
)
from app.services.production_service import ProductionService

router = APIRouter(prefix="/productions", tags=["productions"])
Svc = Depends(get_production_service)


@router.post("", response_model=ApiResponse[ProductionDetail], status_code=202)
def create_production(body: ProductionCreate, svc: ProductionService = Svc) -> dict:
    p = svc.create(body)
    return ok(svc.detail(p.id), "已创建，正在生成内容")


@router.get("", response_model=ApiResponse[ProductionList])
def list_productions(
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    status: ProductionStatus | None = None,
    needs_review: bool = Query(False, description="只看等待人工审核的"),
    account_id: str | None = None,
    svc: ProductionService = Svc,
) -> dict:
    return ok(svc.list_page(page=page, page_size=page_size, status=status.value if status else None,
                            needs_review=needs_review, account_id=account_id))


@router.get("/{production_id}", response_model=ApiResponse[ProductionDetail])
def get_production(production_id: str, svc: ProductionService = Svc) -> dict:
    return ok(svc.detail(production_id))


# ---- 审核 A：分镜 ----
@router.post("/{production_id}/scene/approve", response_model=ApiResponse[ProductionDetail])
def approve_scene(production_id: str, body: ApproveSceneRequest, svc: ProductionService = Svc) -> dict:
    svc.approve_scene(production_id, body)
    return ok(svc.detail(production_id), "分镜已通过，请继续审核台词与字幕")


# ---- 审核 B：台词与字幕 ----
@router.post("/{production_id}/dialogue/approve", response_model=ApiResponse[ProductionDetail])
def approve_dialogue(production_id: str, body: ApproveDialogueRequest, svc: ProductionService = Svc) -> dict:
    svc.approve_dialogue(production_id, body)
    return ok(svc.detail(production_id), "台词已通过，已加入视频生成队列")


@router.post("/{production_id}/dialogue/back", response_model=ApiResponse[ProductionDetail])
def back_to_scene(production_id: str, svc: ProductionService = Svc) -> dict:
    svc.back_to_scene(production_id)
    return ok(svc.detail(production_id), "已退回分镜审核")


# ---- 审核 A / B：带意见重新生成（整体重来，因为台词和分镜来自同一次生成） ----
@router.post("/{production_id}/regenerate", response_model=ApiResponse[ProductionDetail])
def regenerate(production_id: str, body: RegenerateRequest, svc: ProductionService = Svc) -> dict:
    svc.regenerate(production_id, body.feedback)
    return ok(svc.detail(production_id), "正在按意见重新生成内容")


# ---- 审核 C：成片 ----
@router.post("/{production_id}/video/approve", response_model=ApiResponse[ProductionDetail])
def approve_video(production_id: str, svc: ProductionService = Svc) -> dict:
    svc.approve_video(production_id)
    return ok(svc.detail(production_id), "成片已通过，可以发布")


@router.post("/{production_id}/video/regenerate", response_model=ApiResponse[ProductionDetail], status_code=202)
def regenerate_video(production_id: str, body: RegenerateVideoRequest, svc: ProductionService = Svc) -> dict:
    svc.regenerate_video(production_id, body)
    return ok(svc.detail(production_id), "已加入重新生成队列（会产生新的 GPU 费用）")


# ---- 通用 ----
@router.post("/{production_id}/discard", response_model=ApiResponse[ProductionDetail])
def discard(production_id: str, body: DiscardRequest, svc: ProductionService = Svc) -> dict:
    svc.discard(production_id, body.reason)
    return ok(svc.detail(production_id), "已废弃")


@router.post("/{production_id}/published", response_model=ApiResponse[ProductionDetail])
def mark_published(production_id: str, svc: ProductionService = Svc) -> dict:
    svc.mark_published(production_id)
    return ok(svc.detail(production_id), "已标记为已发布")


@router.post("/{production_id}/retry", response_model=ApiResponse[ProductionDetail], status_code=202)
def retry(production_id: str, confirm_duplicate: bool = Query(False), svc: ProductionService = Svc) -> dict:
    svc.retry(production_id, confirm_duplicate)
    return ok(svc.detail(production_id), "已重试")
