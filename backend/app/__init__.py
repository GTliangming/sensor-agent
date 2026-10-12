"""应用工厂与扩展注册。

分层约定（请求从上往下流动）：
    api/      路由层：解析请求、校验参数、拼 SSE 响应，不写业务逻辑
    services/ 业务层：真正的处理逻辑（阶段 1 的 RAG 检索也放这里）
    clients/  外部依赖层：封装 DeepSeek / 向量库等客户端
    schemas/  数据契约：请求体校验、响应结构
"""

from flask import Flask, jsonify

from config import config
from . import db
from .extensions import cors
from .api import register_blueprints


def create_app() -> Flask:
    app = Flask(__name__)
    app.config.from_object(config)
    app.config["MAX_CONTENT_LENGTH"] = config.MAX_UPLOAD_MB * 1024 * 1024  # 单文件上限

    # 初始化 SQLite（建目录 + 建表）
    db.init_db()

    # 扩展
    # CORS_ORIGINS 为 ["*"] 时放行所有源（仅开发期图方便；生产务必收紧白名单）
    origins = "*" if config.CORS_ORIGINS == ["*"] else config.CORS_ORIGINS
    cors.init_app(app, resources={r"/api/*": {"origins": origins}})

    # 路由（蓝图）
    register_blueprints(app)

    # 统一错误处理
    _register_error_handlers(app)

    return app


def _register_error_handlers(app: Flask) -> None:
    @app.errorhandler(400)
    def bad_request(e):
        return jsonify(error=getattr(e, "description", "bad request")), 400

    @app.errorhandler(404)
    def not_found(e):
        return jsonify(error="not found"), 404

    @app.errorhandler(413)
    def too_large(e):
        return jsonify(error=f"文件超过上限 {config.MAX_UPLOAD_MB}MB"), 413

    @app.errorhandler(500)
    def server_error(e):
        return jsonify(error="internal server error"), 500
