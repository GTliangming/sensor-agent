"""Agent 对话接口：会话（Thread）与运行（Run）的 REST 端点。

本层只做「HTTP ↔ service」的编排：解析入参、注入依赖（鉴权用户/DB/LLM）、
把 service 结果包进统一 Envelope 信封。真正的业务逻辑都在 chat_service 里。
所有端点都经 get_current_user 鉴权；service 内部再按 user_id 校验资源归属。
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_current_user, get_llm_client
from app.core.context import current_request_id
from app.db.session import get_db
from app.schemas.agent import (
    CreateRunRequest,
    CreateThreadRequest,
    MessageDTO,
    RunDTO,
    ThreadDTO,
)
from app.schemas.common import Envelope, Meta
from app.services import chat_service

# 本模块所有路由挂在 /agent 下；在 router.py 再统一加全局 /api 前缀
router = APIRouter(prefix="/agent", tags=["agent"])


@router.get("/threads", summary="会话列表")
async def list_threads(
    current: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Envelope[list[ThreadDTO]]:
    # 只列当前登录用户自己的会话（current.user.id 来自鉴权依赖）
    data = await chat_service.list_threads(db, current.user.id)
    return Envelope[list[ThreadDTO]](
        data=data,
        meta=Meta(request_id=current_request_id()),
    )


@router.post("/threads", summary="创建会话")
async def create_thread(
    payload: CreateThreadRequest,  # 请求体自动按 CreateThreadRequest 校验
    current: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Envelope[ThreadDTO]:
    data = await chat_service.create_thread(
        db,
        current.user.id,
        payload.title,
    )
    return Envelope[ThreadDTO](
        data=data,
        meta=Meta(request_id=current_request_id()),
    )


@router.get("/threads/{thread_id}/messages", summary="会话消息")
async def list_messages(
    thread_id: str,  # 路径参数，来自 URL 里的 {thread_id}
    current: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Envelope[list[MessageDTO]]:
    data = await chat_service.list_messages(db, current.user.id, thread_id)
    return Envelope[list[MessageDTO]](
        data=data,
        meta=Meta(request_id=current_request_id()),
    )


@router.post("/threads/{thread_id}/runs", summary="执行一次对话")
async def create_run(
    thread_id: str,
    payload: CreateRunRequest,
    current: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    llm=Depends(get_llm_client),  # 注入 LLM 客户端；测试可用 dependency_overrides 替换成假实现
) -> Envelope[RunDTO]:
    # payload.message 是用户本轮问题；run_chat 负责落库 + 调模型 + 记录结果
    data = await chat_service.run_chat(
        db,
        current.user.id,
        thread_id,
        payload.message,
        llm,
    )
    return Envelope[RunDTO](
        data=data,
        meta=Meta(request_id=current_request_id()),
    )


@router.get("/runs/{run_id}", summary="运行详情")
async def get_run(
    run_id: str,
    current: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Envelope[RunDTO]:
    data = await chat_service.get_run(db, current.user.id, run_id)
    return Envelope[RunDTO](
        data=data,
        meta=Meta(request_id=current_request_id()),
    )