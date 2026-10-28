"""一个进程里同时运行视频 Worker 与生产流程 Worker。

线上建议：API 进程设 WORKER_EMBEDDED=false，另起本进程：python -m app.workers.runner
"""
import asyncio

from app.core.config import Settings, get_settings
from app.core.logging import setup_logging
from app.llm.factory import get_llm
from app.providers.factory import get_provider
from app.storage.factory import get_storage
from app.workers.pipeline_worker import PipelineWorker
from app.workers.video_worker import VideoWorker


async def run_all(settings: Settings, stop: asyncio.Event | None = None) -> None:
    video = VideoWorker(settings, get_provider(), get_storage())
    pipeline = PipelineWorker(settings, get_llm())
    await asyncio.gather(video.run_forever(stop), pipeline.run_forever(stop))


def main() -> None:
    s = get_settings()
    setup_logging(s.log_level)
    asyncio.run(run_all(s))


if __name__ == "__main__":
    main()
