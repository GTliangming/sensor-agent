"""应用配置：从环境变量与 .env 文件加载，进程内单例复用。

约定：
- 字段名小写，pydantic-settings 按「大写 + 下划线」匹配环境变量
  （`app_name` ← `APP_NAME`），大小写不敏感。
- `.env` 只放本地开发用的值，严禁提交真实密钥；模板见 `.env.example`。
- 未在此声明的变量会被 `extra="ignore"` 直接忽略，不会报错。
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """全部运行时配置项；实例化时自动完成类型转换与校验。"""

    # Pydantic v2 的模型配置（必须是 `model_config` 这个保留名）：
    # - env_file / env_file_encoding：读取 .env，按 UTF-8 解码
    # - extra="ignore"：.env 里多出来的变量不报错，方便逐步接入新配置
    # 注意 env_file 是相对「当前工作目录」解析的，因此需在 backend/ 下启动服务。
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # ---- 基础 ----
    app_env: str = "development"  # 运行环境：development / test / production
    app_name: str = "Annotation Ops Agent"
    app_version: str = "0.1.0"  # 对外暴露的版本号；CI 可用 APP_VERSION 注入 git tag
    app_secret_key: str = ""  # 用于签发登录态等，生产环境必须覆盖
    log_level: str = "INFO"

    # ---- 数据库 ----
    # Agent 自有数据（用户、会话、运行记录等），与标注平台业务库完全隔离
    database_url: str = "sqlite+aiosqlite:///./data/app.db"

    # ---- LLM ----
    llm_provider: str = "deepseek"  # 模型供应商，后续可扩展 openai 等
    deepseek_api_key: str = ""  # 密钥走环境变量注入，代码里不要写死
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-chat"  # 模型名集中在此，便于按环境切换

    # ---- 业务侧（Go 标注平台）只读接口 ----
    annotation_api_base_url: str = ""  # 标注平台 /agent/v1 等接口的根地址
    agent_service_id: str = ""  # Agent 服务身份，用于换取业务侧访问凭证
    agent_service_secret: str = ""
    annotation_api_timeout_seconds: int = 10  # 调用业务接口的超时时间（秒）

    # ---- 跨域 ----
    # 前端开发服务器地址；.env 中需写成 JSON 数组字符串
    # 例如 CORS_ORIGINS=["http://localhost:5173"]
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # ---- JWT ----
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 480  # 8 小时

    @property
    def is_dev(self) -> bool:
        """是否开发环境；用于决定是否开启调试日志、放宽鉴权等。"""
        return self.app_env == "development"


@lru_cache
def get_settings() -> Settings:
    """获取配置单例（首次调用时解析 .env，之后命中缓存）。

    作为 FastAPI 依赖注入使用：`settings: Settings = Depends(get_settings)`，
    避免每个请求都重新读取并校验环境变量。
    """
    return Settings()
