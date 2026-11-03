"""认证接口：登录、获取当前用户、登出。

登录签发 JWT，/me 与 /logout 走 get_current_user 依赖做鉴权。
所有响应统一包在 Envelope 信封里，并带上 request_id 便于链路追踪。
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_current_user
from app.core.context import current_request_id
from app.core.error_catalog import ErrorCode
from app.core.errors import AppError
from app.core.security import create_access_token, verify_password
from app.db.models import User, UserPlatformBinding
from app.db.session import get_db
from app.schemas.auth import LoginRequest, LoginResponse, UserDTO
from app.schemas.common import Envelope, Meta

router = APIRouter(prefix="/auth", tags=["auth"])


def _to_user_dto(user: User, binding: UserPlatformBinding | None) -> UserDTO:
    """把 User(+可选绑定) 投影成对外 DTO，顺带算出 bound / go_user_id。"""
    # 只有绑定存在且为 active 才算「已绑定」
    bound = bool(binding and binding.status == "active")
    return UserDTO(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        role=user.role,
        bound=bound,
        # 未绑定则不暴露 go_user_id；bound 为真时 binding 必非 None
        go_user_id=binding.go_user_id if bound and binding else None,
    )

@router.post("/login", summary="登录")
async def login(
    payload: LoginRequest,
    db: AsyncSession = Depends(get_db),
) -> Envelope[LoginResponse]:
    """账号密码登录：校验凭证 → 记录登录时间 → 签发 JWT。"""
    # 按用户名查用户（用户名唯一，至多一条）
    user = (
        await db.execute(
            select(User).where(
                User.username == payload.username
            )
        )
    ).scalar_one_or_none()

    # 用户不存在和密码错误返回同一份文案，避免枚举账号
    # （攻击者无法据此区分「用户名不存在」还是「密码错」）
    if user is None or not verify_password(payload.password, user.password_hash):
        raise AppError(
            ErrorCode.AUTH_INVALID_CREDENTIALS,
            "用户名或密码错误",
            status_code=401,
        )
    # 凭证正确但账号被禁用：认得出但不放行（403）
    if user.status != "active":
        raise AppError(
            ErrorCode.AUTH_USER_DISABLED,
            "用户账号已被禁用,请联系管理员",
            status_code=403,
        )

    # 查平台绑定（可能没有）；bound 状态交由 _to_user_dto 判定
    binding = (
        await db.execute(
            select(UserPlatformBinding).where(
                UserPlatformBinding.agent_user_id == user.id
            )
        )
    ).scalar_one_or_none()

    # 记录最近登录时间并持久化；refresh 拿回数据库侧的最新值
    user.last_login_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(user)

    # 签发访问令牌，载荷含用户 ID 与角色
    token = create_access_token(str(user.id), user.role)

    return Envelope[LoginResponse](
        data=LoginResponse(
            token=token,
            user=_to_user_dto(user, binding),
        ),
        meta=Meta(request_id=current_request_id()),
    )

@router.get("/me", summary="当前用户")
async def me(
    current: CurrentUser = Depends(get_current_user),
) -> Envelope[UserDTO]:
    """返回当前登录用户信息；get_current_user 已完成令牌校验与加载。"""
    return Envelope[UserDTO](
        data=_to_user_dto(current.user, current.binding),
        meta=Meta(request_id=current_request_id()),
    )


@router.post("/logout", summary="登出")
async def logout(
    current: CurrentUser = Depends(get_current_user),
) -> Envelope[dict]:
    """登出接口。

    无状态 JWT：服务端不保存会话，客户端删除 token 即可生效。
    这里仍要求登录态（Depends），仅作语义化端点；令牌在到期前技术上依然有效，
    如需「立即失效」需另加黑名单/短期令牌 + 刷新机制，当前阶段不做。
    """
    return Envelope[dict](
        data={},
        meta=Meta(request_id=current_request_id()),
    )