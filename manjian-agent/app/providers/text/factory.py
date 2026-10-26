"""根据配置选择文本 provider。"""
from __future__ import annotations

from app.config import Settings, get_settings
from app.observability.logging import get_logger
from app.providers.text.base import TextProvider
from app.providers.text.deepseek import DeepSeekTextProvider
from app.providers.text.fake import FakeTextProvider

logger = get_logger(__name__)


def get_text_provider(settings: Settings | None = None) -> TextProvider:
    settings = settings or get_settings()
    choice = settings.resolved_text_provider
    if choice == "deepseek":
        logger.info("text provider = deepseek (model=%s)", settings.deepseek_model)
        return DeepSeekTextProvider(settings)
    logger.info("text provider = fake (本地确定性桩，无网络调用)")
    return FakeTextProvider()
