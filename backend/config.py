import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


class Config:
    """应用配置：统一从环境变量读取，带默认值兜底。

    真实项目里配置集中一处、按环境区分。第一版只有一套，
    需要区分 dev/prod 时可以再派生 DevConfig / ProdConfig 子类。
    """

    # ---- 运行时数据目录（SQLite / FAISS 索引 / 上传的原始文件）----
    BASE_DIR = Path(__file__).resolve().parent
    DATA_DIR = Path(os.getenv("DATA_DIR", str(BASE_DIR / "data"))).resolve()
    DB_PATH = DATA_DIR / "app.db"
    UPLOAD_DIR = DATA_DIR / "uploads"
    FAISS_INDEX_PATH = DATA_DIR / "faiss.index"

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

    # ---- SiliconFlow（向量化 embedding；DeepSeek 没有 embedding 接口）----
    SILICONFLOW_API_KEY = os.getenv("SILICONFLOW_API_KEY")
    SILICONFLOW_BASE_URL = os.getenv(
        "SILICONFLOW_BASE_URL", "https://api.siliconflow.cn/v1"
    )
    EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "BAAI/bge-m3")
    EMBEDDING_DIM = int(os.getenv("EMBEDDING_DIM", "1024"))

    # ---- RAG 分块 / 检索参数（效果不好优先调这里）----
    CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "500"))
    CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "50"))
    TOP_K = int(os.getenv("TOP_K", "8"))

    # ---- 重排 rerank（两阶段检索：向量粗筛 top-n → 交叉编码精排 top-k）----
    # 开关可随时关闭，回退到纯向量 top-k；rerank 走 SiliconFlow /v1/rerank。
    RERANK_ENABLED = os.getenv("RERANK_ENABLED", "1") == "1"
    RERANK_MODEL = os.getenv("RERANK_MODEL", "BAAI/bge-reranker-v2-m3")
    RETRIEVE_TOP_N = int(os.getenv("RETRIEVE_TOP_N", "30"))  # 粗筛候选数（送去精排）
    RERANK_TIMEOUT = float(os.getenv("RERANK_TIMEOUT", "10"))

    # 单文件上传上限（MB）
    MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "100"))

    # ---- Milvus / Redis（阶段 1 接入向量库 / 缓存时启用）----
    MILVUS_HOST = os.getenv("MILVUS_HOST", "localhost")
    MILVUS_PORT = int(os.getenv("MILVUS_PORT", "19530"))
    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

    def validate(self) -> None:
        """启动/首次调用外部服务前校验必填项，缺失早失败、给清晰提示。"""
        if not self.DEEPSEEK_API_KEY:
            raise RuntimeError("缺少 DEEPSEEK_API_KEY，请在 backend/.env 中配置")

    def validate_embedding(self) -> None:
        """用到向量化前再校验 SiliconFlow key（没配 Milvus 时也能先只跑对话）。"""
        if not self.SILICONFLOW_API_KEY:
            raise RuntimeError("缺少 SILICONFLOW_API_KEY，请在 backend/.env 中配置")


config = Config()
