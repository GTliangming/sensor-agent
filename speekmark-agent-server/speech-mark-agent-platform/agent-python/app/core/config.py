from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "语音标注 Agent 服务"
    app_env: str = "development"
    log_level: str = "INFO"
    agent_port: int = 8000

    # DeepSeek 使用 OpenAI 兼容接口；密钥只从服务端环境变量读取。
    model_enabled: bool = False
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-chat"
    deepseek_temperature: float = 0.2
    deepseek_timeout_seconds: float = 60.0

    go_backend_base_url: str = "http://localhost:8080/api/v1"
    request_timeout_seconds: float = 30.0
    # 支持从 agent-python/.env 或项目根目录 .env 读取配置。
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
