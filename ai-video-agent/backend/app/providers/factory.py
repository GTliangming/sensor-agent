"""根据 VIDEO_PROVIDER 创建 Provider。新增服务商只需在此注册。"""
import logging
from functools import lru_cache

from app.core.config import get_settings
from app.providers.autodl_comfyui import AutoDLComfyUIProvider
from app.providers.base import VideoProvider
from app.providers.fake import FakeProvider

logger = logging.getLogger(__name__)


@lru_cache
def get_provider() -> VideoProvider:
    s = get_settings()
    if s.video_provider == "autodl":
        return AutoDLComfyUIProvider(s)
    if s.video_provider == "fake":
        logger.warning("VIDEO_PROVIDER=fake：产出的不是真实 AI 视频，仅用于开发/测试")
        return FakeProvider()
    raise ValueError(f"未知的 VIDEO_PROVIDER: {s.video_provider}")
