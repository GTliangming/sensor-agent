"""API 路由汇总：把各业务域的子路由挂到同一个 `api_router` 上。

路径拼接规则（从外到内）：

    main.py 的 prefix  +  本文件 include_router 的 prefix  +  子路由自身的 path
    "/api"                 （health 为空）                    "/health"   →  /api/health

约定：

- **前缀分层**：`/api` 这种全局前缀只在 `main.py` 写一次；各业务域前缀
  （如 `/agent`、`/reports`）在这里分配；具体资源路径由各子模块自己负责，
  这样换 API 版本（`/api` → `/api/v1`）时只改一处。
- **子模块自治**：每个模块自己建 `APIRouter`、声明 `tags` 和依赖，
  本文件只负责「注册」，不写业务逻辑，避免变成第二个 main。
- 新增路由时按域追加，例如：

      from app.api import agent, health, reports
      api_router.include_router(health.router)
      api_router.include_router(agent.router, prefix="/agent")
      api_router.include_router(reports.router, prefix="/reports")
"""

from fastapi import APIRouter

from app.api import health,auth

# 全局 API 前缀：main.py 挂载路由、拼接 docs/openapi 地址时都引用这里，
# 将来升级成 /api/v1 只需改这一行。
API_PREFIX = "/api"

# 汇总用的空壳 router：自身不带 prefix/tags，交由 main.py 统一加 API_PREFIX
api_router = APIRouter()

# 系统类接口（健康检查等）直接挂在 /api 下，路径即 /api/health
api_router.include_router(health.router)
api_router.include_router(auth.router)
