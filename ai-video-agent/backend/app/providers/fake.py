"""开发/测试用的假 Provider。

!!! 它不会调用任何 GPU 服务，产出的视频不是 AI 生成的结果，
只用来在没有 AutoDL 的情况下跑通“创建 -> 轮询 -> 转存 -> 播放”链路。
真实验收必须使用 VIDEO_PROVIDER=autodl。
"""
import asyncio
import shutil
from pathlib import Path

from app.core.exceptions import ProviderError
from app.domain.status import TaskStatus
from app.providers.base import ProviderStatus, SubmitRequest

# 最小的 MP4 头（仅 ftyp box）。没有 ffmpeg 时用它兜底，能通过基础校验但无法播放。
_STUB_MP4 = bytes.fromhex("000000186674797069736f6d0000020069736f6d6d703431")


class FakeProvider:
    name = "fake"

    def __init__(self, polls_before_done: int = 2) -> None:
        self.polls_before_done = polls_before_done
        self._polls: dict[str, int] = {}
        # 测试可设置：让下一次 submit/get_status 抛出指定错误
        self.fail_next_submit: ProviderError | None = None
        self.fail_with: str | None = None  # 非空则轮询时返回失败，值为错误信息

    async def submit(self, req: SubmitRequest) -> str:
        if self.fail_next_submit:
            err, self.fail_next_submit = self.fail_next_submit, None
            raise err
        task_id = f"fake-{req.request_token}"
        self._polls[task_id] = 0
        return task_id

    async def get_status(self, provider_task_id: str) -> ProviderStatus:
        self._polls[provider_task_id] = self._polls.get(provider_task_id, 0) + 1
        if self.fail_with:
            return ProviderStatus(TaskStatus.FAILED, error_code="PROVIDER_TASK_FAILED", error_message=self.fail_with)
        if self._polls[provider_task_id] < self.polls_before_done:
            return ProviderStatus(TaskStatus.RUNNING, progress=0.5)
        return ProviderStatus(TaskStatus.SUCCEEDED, video_url=f"fake://{provider_task_id}")

    async def download_result(self, status: ProviderStatus, dest: Path, max_bytes: int) -> str:
        if shutil.which("ffmpeg"):
            # 用 ffmpeg 合成 2 秒纯色竖屏视频，本地可以真实播放
            proc = await asyncio.create_subprocess_exec(
                "ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
                "-i", "color=c=0x335577:s=540x960:d=2:r=24",
                "-pix_fmt", "yuv420p", "-f", "mp4", str(dest),
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
            )
            if await proc.wait() == 0:
                return "video/mp4"
        dest.write_bytes(_STUB_MP4)
        return "video/mp4"

    async def ping(self) -> dict:
        return {"provider": self.name, "configured": True, "reachable": True, "note": "fake provider, 非真实生成"}
