"""Provider 自检。生成配置（工作流、视频方向等）不在这里：它们跟账号类型走，见 /business-lines。"""
from fastapi import APIRouter, Depends

from app.core.config import Settings, get_settings
from app.core.exceptions import NotFoundError
from app.providers.factory import get_provider
from app.schemas.common import ok

router = APIRouter(tags=["providers"])


@router.get("/providers/status")
async def provider_status(settings: Settings = Depends(get_settings)) -> dict:
    """连接与密钥的自检。没有鉴权体系，生产环境直接关闭。"""
    if settings.is_production:
        raise NotFoundError()
    return ok(await get_provider().ping())
