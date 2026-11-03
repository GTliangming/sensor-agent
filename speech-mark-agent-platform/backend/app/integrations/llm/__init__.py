"""LLM 集成层：对外只暴露稳定的客户端与数据结构。"""

from app.integrations.llm.client import DeepSeekClient
from app.integrations.llm.types import LLMMessage, LLMResult

__all__ = ["DeepSeekClient", "LLMMessage", "LLMResult"]
