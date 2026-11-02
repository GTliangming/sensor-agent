"""应用入口：只负责「组装」，不承载具体实现。

装配细节各自归位，main.py 保持一眼能读完：

| 关注点       | 位置                          |
|--------------|-------------------------------|
| 启动/关停    | `app.core.lifespan`           |
| 全局中间件   | `app.core.middleware.setup_middlewares` |
| 异常处理     | `app.core.errors.register_exception_handlers` |
| 路由汇总     | `app.api.router.api_router`   |
| 配置来源     | `app.core.config.Settings`    |

这里的 `create_app()` 是组合根（composition root）：新增基础设施时只改上面
对应模块并在工厂里多调一行，不要把实现细节搬回本文件。
"""

from fastapi import FastAPI

from app.api.router import API_PREFIX, api_router
from app.core.config import get_settings
from app.core.errors import register_exception_handlers
from app.core.lifespan import lifespan
from app.core.middleware import setup_middlewares


def create_app() -> FastAPI:
    """创建 FastAPI 实例；测试中可重复调用得到互不干扰的应用。"""
    settings = get_settings()

    app = FastAPI(
        title="Annotation Ops Agent API",
        version=settings.app_version,  # 与 /api/health 返回的 version 同源
        # 文档与 OpenAPI 挂在 API_PREFIX 下，和业务接口保持同一前缀
        docs_url=f"{API_PREFIX}/docs",
        redoc_url=None,  # 只保留 Swagger UI，减少一份重复文档
        openapi_url=f"{API_PREFIX}/openapi.json",
        lifespan=lifespan,
    )

    # 中间件顺序（CORS 在内、RequestId 在外）在 setup_middlewares 内保证
    setup_middlewares(app, settings)
    register_exception_handlers(app)
    app.include_router(api_router, prefix=API_PREFIX)
    return app


# 模块级实例：uvicorn 的入口 `app.main:app` 读取它
app = create_app()
