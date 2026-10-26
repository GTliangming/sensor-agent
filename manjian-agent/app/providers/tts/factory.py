"""根据配置选择 TTS provider。"""
from __future__ import annotations

from app.config import Settings, get_settings
from app.observability.logging import get_logger
from app.providers.tts.base import TTSProvider
from app.providers.tts.fake import FakeTTSProvider
from app.providers.tts.siliconflow import SiliconFlowTTSProvider

logger = get_logger(__name__)


def get_tts_provider(settings: Settings | None = None) -> TTSProvider:
    settings = settings or get_settings()
    choice = settings.resolved_tts_provider
    if choice == "siliconflow":
        logger.info("tts provider = siliconflow (model=%s)", settings.tts_model)
        return SiliconFlowTTSProvider(settings)
    logger.info("tts provider = fake (本地静音音频，无网络调用)")
    return FakeTTSProvider()
