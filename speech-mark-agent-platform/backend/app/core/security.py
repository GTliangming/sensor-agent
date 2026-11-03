"""认证安全工具：密码哈希与 JWT 访问令牌的签发/校验。

集中放这里是为了让「怎么存密码、怎么签发登录态」只有一处实现，
路由/服务层只调用这几个函数，不直接碰 pwdlib / jwt 细节。
"""

from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from pwdlib import PasswordHash

from app.core.config import get_settings
from app.core.error_catalog import ErrorCode
from app.core.errors import AppError

# 密码哈希器（进程内单例）：recommended() 选用当前推荐算法（Argon2），
# 自带加盐，并把算法/参数编码进哈希串，后续升级算法仍能校验旧哈希。
_password_hash = PasswordHash.recommended()


def hash_password(password: str) -> str:
    """对明文密码进行哈希处理，返回哈希值（含盐与算法参数）。"""
    return _password_hash.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    """验证明文密码是否与哈希值匹配。"""
    return _password_hash.verify(password, hashed_password)


def create_access_token(user_id: str, role: str) -> str:
    """签发 JWT 访问令牌：把用户身份与角色写入载荷并用密钥签名。"""
    settings = get_settings()
    now = datetime.now(UTC)
    payload = {
        "sub": user_id,  # subject：令牌主体，即用户 ID
        "role": role,  # 角色：供鉴权时做权限判断，省去再查库
        "iat": now,  # 签发时间
        # 过期时间：超时后 decode 会抛 ExpiredSignatureError
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
    }
    # 用应用密钥 + 对称算法（默认 HS256）签名；密钥生产环境务必覆盖默认空值
    return jwt.encode(
        payload,
        settings.app_secret_key,
        algorithm=settings.jwt_algorithm,
    )


def decode_access_token(token: str) -> dict[str, Any]:
    """校验并解析访问令牌；失败时抛出统一的 AppError（HTTP 401）。"""
    settings = get_settings()
    try:
        return jwt.decode(
            token,
            settings.app_secret_key,
            algorithms=[settings.jwt_algorithm],
            # require 强制令牌必须带 sub 和 exp，缺失即视为无效，避免无过期的长效令牌
            options={"require": ["sub", "exp"]},
        )
    except jwt.ExpiredSignatureError as exc:
        # 令牌本身合法但已过期：前端应引导重新登录
        raise AppError(
            ErrorCode.AUTH_TOKEN_EXPIRED,
            "登录状态已过期，请重新登录",
            status_code=401,
        ) from exc
    except jwt.InvalidTokenError as exc:
        # 签名错误、格式损坏、缺少必需字段等：一律当作无效令牌
        # 注意 ExpiredSignatureError 是 InvalidTokenError 的子类，故必须先捕获过期分支
        raise AppError(
            ErrorCode.AUTH_TOKEN_INVALID,
            "登录状态无效，请重新登录",
            status_code=401,
        ) from exc
