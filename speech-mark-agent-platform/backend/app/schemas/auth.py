"""认证相关的对外 DTO：登录请求/响应与用户信息。

继承 APIModel，故 Python 侧写 snake_case、HTTP 上自动转 camelCase
（如 display_name ↔ displayName、go_user_id ↔ goUserId）。
"""

from app.schemas.base import APIModel


class LoginRequest(APIModel):
    """登录入参：用户名 + 明文密码（走 HTTPS 传输，服务端比对哈希）。"""

    username: str
    password: str


class UserDTO(APIModel):
    """对外返回的用户信息；不含密码哈希等敏感字段。"""

    id: str
    username: str
    display_name: str
    role: str  # 角色，前端据此控制可见功能（如 admin / annotator）
    # 是否已绑定 Go 标注平台账号；未绑定时部分业务接口不可用
    bound: bool
    # 绑定的 Go 平台用户 ID；未绑定则为 None
    go_user_id: str | None = None


class LoginResponse(APIModel):
    """登录成功返回：JWT 令牌 + 当前用户信息，前端据此落地登录态。"""

    token: str  # 由 create_access_token 签发的 JWT，后续请求放 Authorization 头
    user: UserDTO