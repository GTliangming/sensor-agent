"""FastAPI 应用入口：装配 ASGI 应用、CORS 中间件与各业务路由。

这是整个 Agent 服务的启动模块，`uvicorn app.main:app` 会加载此处创建的 `app` 实例。
应用的具体能力分散在各模块中，这里只负责把它们组装起来：
- 生命周期钩子 → app.core.lifespan
- 业务路由（/v1 下的 runs 相关接口）→ app.api.routes
- 健康检查探针 → app.api.health
"""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router as run_router
from app.api.health import router as health_router
from app.core.config import settings
from app.core.lifespan import lifespan

# 以配置项中的日志级别初始化根 logger；无效级别时回退为 INFO。
logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO), format="%(asctime)s %(levelname)s %(name)s %(message)s")

# 创建 ASGI 应用实例；title/version/description 会直接体现在自动生成的 OpenAPI 文档（/docs）中。
app = FastAPI(title=settings.app_name, version="0.1.0", description="面向语音标注业务的 Agent API 骨架", lifespan=lifespan)
# 注册 CORS 中间件，仅放行本地前端（Vite 默认端口 5173）的跨域调用，并限定可用的 HTTP 方法。
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_credentials=False, allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["*"])
# 挂载业务路由与健康检查路由，使其成为应用的一部分。
app.include_router(run_router)
app.include_router(health_router)
