"""统一配置：所有环境差异都通过环境变量 / .env 控制，代码里不判断具体环境。"""
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ---- 应用 ----
    app_env: str = "local"
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    log_level: str = "INFO"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # ---- 数据库 / Redis ----
    database_url: str = "sqlite:///./data/ai_video_studio.db"
    # 启动时自动执行 alembic upgrade head（本地开发省去手动建表）；线上建议关闭，由发布流程执行迁移
    auto_migrate: bool = True
    redis_enabled: bool = False
    redis_url: str = "redis://localhost:6379/0"

    # ---- Provider ----
    # 这里只放“连接与密钥”。工作流 ID、请求字段名、视频方向、seed 等生成配置跟着账号类型存数据库（账号设置里改）。
    video_provider: str = "fake"  # fake | autodl
    autodl_api_token: str = ""
    autodl_auth_header: str = "Authorization"
    autodl_auth_prefix: str = ""
    autodl_submit_path: str = "/api/v1/comfyui/comfyui_workflow/{workflow_id}"
    autodl_base_url: str = "https://autodl.art"
    autodl_result_path: str = "/api/v1/comfyui/comfyui_workflow/result/{task_id}"
    autodl_result_allowed_hosts: str = ""
    autodl_request_timeout_seconds: float = 30
    autodl_download_timeout_seconds: float = 300
    # 仅在首次写入出厂数据时，作为“女性向情感治愈类”账号类型的工作流 ID 默认值；之后以数据库为准
    autodl_workflow_id: str = ""

    # ---- Worker ----
    worker_embedded: bool = True
    worker_idle_sleep_seconds: float = 2
    worker_lease_seconds: int = 120
    autodl_poll_interval_seconds: float = 5
    autodl_poll_max_interval_seconds: float = 30
    autodl_max_poll_seconds: int = 1800
    submit_max_retries: int = 2
    task_max_retries: int = 3

    # ---- 夜间生成窗口（AutoDL 夜间便宜；它只提供“创建任务/查询结果”两个 API，无法启停实例，
    #      所以只能控制“什么时候提交任务”） ----
    timezone: str = "Asia/Shanghai"
    generation_window_enabled: bool = True
    generation_window_start: str = "23:00"
    generation_window_end: str = "07:00"
    # 同时在 GPU 上运行（已提交/运行中）的任务上限。创建任务不受限，超出的任务在后台排队
    generation_max_inflight: int = 3

    # ---- 文本 LLM（场景提示词 / 对话文案） ----
    llm_provider: str = "fake"  # fake | deepseek
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-chat"
    llm_timeout_seconds: float = 60
    llm_max_retries: int = 2
    # 生产流程（LLM 阶段）的租约，需大于 llm_timeout * (llm_max_retries + 1)
    pipeline_lease_seconds: int = 300

    # ---- 存储与限制 ----
    local_storage_dir: str = "./storage"
    public_base_url: str = "http://127.0.0.1:8000"
    max_upload_bytes: int = 10 * 1024 * 1024
    max_result_bytes: int = 500 * 1024 * 1024
    max_prompt_length: int = Field(default=20000, ge=1)  # AutoDL 文档：prompt 1-20000 个字符
    # 手动创建任务时允许同时排队/进行中的任务总数（防误操作堆积；真正的 GPU 并发由 generation_max_inflight 控制）
    max_active_tasks: int = 50

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def result_allowed_host_list(self) -> list[str]:
        return [h.strip().lower() for h in self.autodl_result_allowed_hosts.split(",") if h.strip()]

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    """进程内单例；测试里可通过 get_settings.cache_clear() 重新加载。"""
    return Settings()
