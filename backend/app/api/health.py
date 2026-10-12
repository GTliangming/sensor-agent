from flask import Blueprint, jsonify

# 健康检查：确认服务起来了（部署/联调时很有用）
health_bp = Blueprint("health", __name__, url_prefix="/api")


@health_bp.get("/health")
def health():
    return jsonify(status="ok")
