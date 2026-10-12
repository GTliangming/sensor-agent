from flask import Blueprint, Response, abort, request
from pydantic import ValidationError

from ..schemas.chat import ChatRequest
from ..services.rag_service import stream_answer

chat_bp = Blueprint("chat", __name__, url_prefix="/api")


@chat_bp.post("/chat")
def chat():
    """提问接口：SSE 流式返回答案（RAG：检索 → 拼 Prompt → 作答，带出处）。

    路由层只负责：校验参数 → 交给 service → 把生成器包成 SSE 响应。
    业务逻辑在 services/rag_service.py 里。
    """
    try:
        payload = ChatRequest.model_validate(request.get_json(silent=True) or {})
    except ValidationError as e:
        abort(400, description=f"参数错误：{e.errors()[0]['msg']}")

    return Response(
        stream_answer(payload.question),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # 让 Nginx 等反代不缓冲，SSE 才能实时推
        },
    )
