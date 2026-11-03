"""API 层依赖：从请求中解析并校验当前登录用户。

路由通过 `user: CurrentUser = Depends(get_current_user)` 拿到已鉴权的用户，
鉴权逻辑只写一处，各接口不必重复解析 token / 查库。
"""

from dataclasses import dataclass

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_catalog import ErrorCode
from app.core.errors import AppError
from app.core.security import decode_access_token
from app.db.models import User, UserPlatformBinding
from app.db.session import get_db

# 解析 Authorization: Bearer <token> 头。
# auto_error=False：缺少/格式错时不由 FastAPI 直接抛 403，而是返回 None，
# 交给下面统一抛成项目的 AppError（401），保证错误信封格式一致。
bearer = HTTPBearer(auto_error=False)


@dataclass
class CurrentUser:
    """已鉴权用户的聚合对象：用户本身 + 其平台绑定（可能没有）。"""

    user: User
    binding: UserPlatformBinding | None

    @property
    def go_user_id(self) -> str | None:
        """取有效的 Go 平台用户 ID；未绑定或绑定非 active 时为 None。

        供需要代用户调 Go 标注平台接口的场景使用；返回 None 即表示
        该用户还不能执行依赖平台身份的操作。
        """
        if self.binding and self.binding.status == "active":
            return self.binding.go_user_id
        return None


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    """校验令牌并加载当前用户；任一步失败都抛 AppError（401/403）。"""
    # 1) 没带令牌：未登录
    if credentials is None:
        raise AppError(ErrorCode.AUTH_TOKEN_INVALID, "请先登录！", status_code=401)

    # 2) 解析令牌（过期/非法会在 decode_access_token 内抛 401），取出用户 ID
    payload = decode_access_token(credentials.credentials)
    user_id = payload["sub"]

    # 3) 按 ID 查库：令牌有效但用户已被删除时也要拦下
    user = await db.get(User, user_id)
    if user is None:
        raise AppError(ErrorCode.AUTH_TOKEN_INVALID, "登录凭证无效", status_code=401)
    # 4) 账号被禁用：令牌有效但不允许访问（403 而非 401，语义是「认了但没权限」）
    if user.status != "active":
        raise AppError(ErrorCode.AUTH_USER_DISABLED, "用户账号已被禁用", status_code=403)

    # 5) 查其有效的平台绑定（可能没有）；scalar_one_or_none：至多一条，没有则 None
    binding = (
        await db.execute(
            select(UserPlatformBinding).where(
                UserPlatformBinding.agent_user_id == user_id,
                UserPlatformBinding.status == "active",
            )
        )
    ).scalar_one_or_none()

    return CurrentUser(user=user, binding=binding)