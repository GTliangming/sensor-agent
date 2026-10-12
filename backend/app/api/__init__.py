"""路由层：集中注册所有蓝图。新增一组接口时，在这里 import 并 register。"""

from flask import Flask

from .chat import chat_bp
from .documents import documents_bp
from .health import health_bp


def register_blueprints(app: Flask) -> None:
    app.register_blueprint(health_bp)
    app.register_blueprint(chat_bp)
    app.register_blueprint(documents_bp)
