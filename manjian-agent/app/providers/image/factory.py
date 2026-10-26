"""根据配置选择图像 provider。"""
from __future__ import annotations

from app.config import Settings, get_settings
from app.observability.logging import get_logger
from app.providers.image.base import ImageProvider
from app.providers.image.fake import FakeImageProvider
from app.providers.image.siliconflow import SiliconFlowImageProvider

logger = get_logger(__name__)


def get_image_provider(settings: Settings | None = None) -> ImageProvider:
    settings = settings or get_settings()
    choice = settings.resolved_image_provider
    if choice == "siliconflow":
        logger.info("image provider = siliconflow (model=%s)", settings.image_model)
        return SiliconFlowImageProvider(settings)
    logger.info("image provider = fake (本地占位图，无网络调用)")
    return FakeImageProvider()
