"""应用配置。

密钥仅从环境变量 / .env 读取；预算类配置由普通代码强制执行，模型不可覆盖。

模型分工（用户决策）：
- 文本/分镜：DeepSeek。
- 图像补图 / TTS / 图生视频：SiliconFlow（Qwen-Image / CosyVoice2 / Wan2.2-I2V）。
- 图生视频可切换到 MiniMax（海螺 H3 / Hailuo 2.3）。
- 合成：本地 FFmpeg。
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(PROJECT_ROOT / ".env"), env_file_encoding="utf-8", extra="ignore",
    )

    app_env: str = "dev"
    cors_allow_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    log_level: str = "INFO"

    data_dir: str = "data"
    db_path: str = "data/manjian.db"

    # 文本（DeepSeek）
    text_provider: Literal["auto", "deepseek", "fake"] = "auto"
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-chat"

    # SiliconFlow（图像 / TTS / 图生视频 / embedding 共用）
    siliconflow_api_key: str = ""
    siliconflow_base_url: str = "https://api.siliconflow.cn/v1"

    # MiniMax（图生视频可选）
    minimax_api_key: str = ""
    minimax_base_url: str = "https://api.minimaxi.com/v1"

    # 图像生成（阶段 3）
    image_provider: Literal["auto", "siliconflow", "fake"] = "auto"
    image_model: str = "Qwen/Qwen-Image"
    image_size: str = "928x1664"
    image_num_inference_steps: int = 20

    # 配音 TTS（阶段 4）
    tts_provider: Literal["auto", "siliconflow", "fake"] = "auto"
    tts_model: str = "FunAudioLLM/CosyVoice2-0.5B"
    tts_voice: str = "FunAudioLLM/CosyVoice2-0.5B:alex"
    tts_speed: float = 1.0

    # 图生视频（可选升级；none=退回图片+Ken Burns）
    video_gen_provider: Literal["auto", "wan", "minimax", "fake", "none"] = "auto"
    video_wan_model: str = "Wan-AI/Wan2.2-I2V-A14B"
    video_minimax_model: str = "MiniMax-Hailuo-2.3"
    video_clip_seconds: float = 5.0
    video_poll_interval: float = 5.0
    video_gen_timeout: float = 600.0
    # 配音来源：video=用视频自带音轨（若模型产出音频），tts=用我们自己的 CosyVoice
    audio_source: Literal["video", "tts"] = "video"

    # 视频渲染（FFmpeg）
    video_width: int = 1080
    video_height: int = 1920
    video_fps: int = 30
    max_output_seconds: int = 120
    video_motion: bool = True
    transition_seconds: float = 0.5

    # 编排模式与并发/恢复（阶段 5-7）
    graph_mode: Literal["single", "multi"] = "single"
    max_concurrent_tasks: int = 2
    max_scene_concurrency: int = 4
    task_total_timeout_seconds: float = 900.0
    task_retention_days: int = 7
    recover_orphans_on_start: bool = True
    # 取消监视器轮询间隔(秒):运行中的节点也能在该间隔内被中断
    cancel_poll_seconds: float = 0.5
    # 多 Agent 返工上限（阶段 6）
    max_storyboard_revisions: int = 1
    max_asset_rechecks: int = 1

    # 预算 / 超时
    max_llm_calls: int = 4
    max_retry_per_step: int = 2
    http_timeout_seconds: float = 60.0
    image_timeout_seconds: float = 120.0
    tts_timeout_seconds: float = 120.0
    render_timeout_seconds: float = 300.0

    # ---- 派生路径 ----
    @property
    def data_path(self) -> Path:
        p = Path(self.data_dir)
        return p if p.is_absolute() else PROJECT_ROOT / p

    @property
    def db_file(self) -> Path:
        p = Path(self.db_path)
        return p if p.is_absolute() else PROJECT_ROOT / p

    @property
    def checkpoint_file(self) -> Path:
        """HITL 暂停点（LangGraph checkpoint）的持久化库，与业务库分文件。"""
        return self.db_file.with_name(f"{self.db_file.stem}_checkpoints.db")

    @property
    def generated_dir(self) -> Path:
        return self.data_path / "generated"

    @property
    def tasks_dir(self) -> Path:
        return self.data_path / "tasks"

    # ---- provider 解析 ----
    @property
    def resolved_text_provider(self) -> Literal["deepseek", "fake"]:
        if self.text_provider == "auto":
            return "deepseek" if self.deepseek_api_key.strip() else "fake"
        return self.text_provider

    @property
    def resolved_image_provider(self) -> Literal["siliconflow", "fake"]:
        if self.image_provider == "auto":
            return "siliconflow" if self.siliconflow_api_key.strip() else "fake"
        return self.image_provider

    @property
    def resolved_tts_provider(self) -> Literal["siliconflow", "fake"]:
        if self.tts_provider == "auto":
            return "siliconflow" if self.siliconflow_api_key.strip() else "fake"
        return self.tts_provider

    @property
    def resolved_video_provider(self) -> Literal["wan", "minimax", "fake", "none"]:
        if self.video_gen_provider != "auto":
            return self.video_gen_provider
        if self.siliconflow_api_key.strip():
            return "wan"
        return "fake"

    @property
    def image_wh(self) -> tuple[int, int]:
        w, _, h = self.image_size.lower().partition("x")
        return int(w), int(h)


@lru_cache
def get_settings() -> Settings:
    return Settings()
