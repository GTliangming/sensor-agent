import os

from dotenv import load_dotenv

load_dotenv()


class Config:
    """应用配置：统一从环境变量读取，带默认值兜底。

    真实项目里配置集中一处、按环境区分。第一版只有一套，
    需要区分 dev/prod 时可以再派生 DevConfig / ProdConfig 子类。
    """

    # ---- Flask / 运行 ----
    HOST = os.getenv("HOST", "127.0.0.1")
    PORT = int(os.getenv("PORT", "5000"))
    DEBUG = os.getenv("FLASK_DEBUG", "1") == "1"

    # 允许跨域的前端地址（Vite 默认 5173），多个用逗号分隔。
    # 默认同时放行 localhost 和 127.0.0.1 两个 host——它俩在 CORS 里算不同源。
    CORS_ORIGINS = os.getenv(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")

    # ---- DeepSeek（对话，OpenAI 兼容接口）----
    DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
    DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-flash")

    # ---- 阶段 1 接入 RAG 时再启用（embedding / 向量库 / 缓存）----
    # SILICONFLOW_API_KEY = os.getenv("SILICONFLOW_API_KEY")
    # MILVUS_HOST = os.getenv("MILVUS_HOST", "localhost")
    # REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

    def validate(self) -> None:
        """启动/首次调用外部服务前校验必填项，缺失早失败、给清晰提示。"""
        if not self.DEEPSEEK_API_KEY:
            raise RuntimeError("缺少 DEEPSEEK_API_KEY，请在 backend/.env 中配置")


config = Config()
