"""根据 LLM_PROVIDER 创建文本模型客户端。"""
import logging
from functools import lru_cache

from app.core.config import get_settings
from app.llm.base import LLMClient
from app.llm.deepseek import DeepSeekClient
from app.llm.fake import FakeLLM

logger = logging.getLogger(__name__)


@lru_cache
def get_llm() -> LLMClient:
    s = get_settings()
    if s.llm_provider == "deepseek":
        return DeepSeekClient(s)
    if s.llm_provider == "fake":
        logger.warning("LLM_PROVIDER=fake：场景提示词/台词是占位内容，仅用于开发测试")
        return FakeLLM()
    raise ValueError(f"未知的 LLM_PROVIDER: {s.llm_provider}")
