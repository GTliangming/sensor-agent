"""业务线与账号类型接口。"""
from fastapi import APIRouter, Depends

from app.api.deps import get_account_service
from app.llm.factory import get_llm
from app.schemas.account import (
    AccountTypeCreate, AccountTypeOut, AccountTypeUpdate, BusinessLineOut, SuggestTopicOut,
)
from app.schemas.common import ApiResponse, ok
from app.services.account_service import AccountService, to_out

router = APIRouter(tags=["accounts"])


@router.get("/business-lines", response_model=ApiResponse[list[BusinessLineOut]])
def list_business_lines(svc: AccountService = Depends(get_account_service)) -> dict:
    """业务线及其下的账号类型，前端据此渲染导航。"""
    return ok(svc.business_lines())


@router.post("/accounts", response_model=ApiResponse[AccountTypeOut], status_code=201)
def create_account_type(body: AccountTypeCreate, svc: AccountService = Depends(get_account_service)) -> dict:
    return ok(to_out(svc.create(body)), "账号类型已创建")


@router.get("/accounts/{account_id}", response_model=ApiResponse[AccountTypeOut])
def get_account_type(account_id: str, svc: AccountService = Depends(get_account_service)) -> dict:
    return ok(to_out(svc.get(account_id)))


@router.put("/accounts/{account_id}", response_model=ApiResponse[AccountTypeOut])
def update_account_type(account_id: str, body: AccountTypeUpdate, svc: AccountService = Depends(get_account_service)) -> dict:
    return ok(to_out(svc.update(account_id, body)), "已保存")


@router.post("/accounts/{account_id}/suggest-topic", response_model=ApiResponse[SuggestTopicOut])
async def suggest_topic(account_id: str, svc: AccountService = Depends(get_account_service)) -> dict:
    """让大模型想一个新主题，用户可以直接用，也可以改。"""
    return ok(SuggestTopicOut(topic=await svc.suggest_topic(account_id, get_llm())))
