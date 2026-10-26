"""根据配置选择图生视频 provider（none 表示不启用，退回图片+Ken Burns）。"""
from __future__ import annotations

from app.config import Settings, get_settings
from app.observability.logging import get_logger
from app.providers.video.base import VideoProvider
from app.providers.video.fake import FakeVideoProvider
from app.providers.video.minimax import MiniMaxVideoProvider
from app.providers.video.wan import WanVideoProvider

logger = get_logger(__name__)


def get_video_provider(settings: Settings | None = None) -> VideoProvider | None:
    settings = settings or get_settings()
    choice = settings.resolved_video_provider
    if choice == "none":
        logger.info("video gen 关闭：使用图片 + Ken Burns 运镜")
        return None
    if choice == "wan":
        logger.info("video provider = wan (model=%s)", settings.video_wan_model)
        return WanVideoProvider(settings)
    if choice == "minimax":
        logger.info("video provider = minimax (model=%s)", settings.video_minimax_model)
        return MiniMaxVideoProvider(settings)
    logger.info("video provider = fake (本地 ffmpeg 占位短片，无网络)")
    return FakeVideoProvider(settings.video_width, settings.video_height, settings.video_fps)
