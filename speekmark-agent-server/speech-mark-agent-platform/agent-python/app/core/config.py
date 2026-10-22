"""应用配置模块。

基于 pydantic-settings 的 BaseSettings 集中管理服务的全部配置项，
支持从环境变量与 .env 文件读取，并通过 lru_cache 暴露一个全局单例配置。
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """服务配置模型。

    继承自 pydantic-settings 的 BaseSettings：每个字段都会自动按
    “环境变量 > .env 文件 > 此处默认值”的优先级完成读取、类型转换与校验。
    环境变量名默认与字段名同名（大小写不敏感），例如字段 ``model_enabled``
    对应环境变量 ``MODEL_ENABLED``。
    """

    # 基础运行信息：服务名、运行环境、日志级别与监听端口。
    app_name: str = "语音标注 Agent 服务"
    app_env: str = "development"
    log_level: str = "INFO"
    agent_port: int = 8000

    # DeepSeek 使用 OpenAI 兼容接口；密钥只从服务端环境变量读取。
    model_enabled: bool = False  # 总开关：是否启用真实大模型，关闭时走降级/桩逻辑
    deepseek_api_key: str = ""  # DeepSeek API 密钥，仅从服务端环境注入，不写入代码
    deepseek_base_url: str = "https://api.deepseek.com"  # OpenAI 兼容网关地址
    deepseek_model: str = "deepseek-chat"  # 使用的模型名称
    deepseek_temperature: float = 0.2  # 采样温度，越低输出越稳定确定
    deepseek_timeout_seconds: float = 60.0  # 单次模型调用的超时时间（秒）

    go_backend_base_url: str = "http://localhost:8080/api/v1"  # 下游 Go 后端的基础地址
    request_timeout_seconds: float = 30.0  # 调用 Go 后端的请求超时时间（秒）
    # 支持从 agent-python/.env 或项目根目录 .env 读取配置。
    # SettingsConfigDict 用于描述配置加载行为：
    # - env_file：按顺序尝试加载的 .env 文件路径；
    # - env_file_encoding：.env 文件编码；
    # - extra="ignore"：忽略 .env/环境变量中未在本模型声明的多余键，避免报错。
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    """返回全局唯一的配置实例。

    使用 lru_cache 缓存：首次调用时构造并解析一次 Settings，
    之后的调用直接返回同一对象，避免重复读取环境变量/文件（单例效果）。
    """
    return Settings()


# 模块级单例，供其他模块直接 import 使用。
settings = get_settings()
