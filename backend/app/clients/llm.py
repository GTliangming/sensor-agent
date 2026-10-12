"""外部依赖层：封装对第三方服务的客户端创建。"""

from functools import lru_cache

from openai import OpenAI

from config import config


@lru_cache(maxsize=1)
def get_llm_client() -> OpenAI:
    """DeepSeek 走 OpenAI 兼容接口；客户端进程内只建一次、复用。"""
    config.validate()
    return OpenAI(api_key=config.DEEPSEEK_API_KEY, base_url=config.DEEPSEEK_BASE_URL)
