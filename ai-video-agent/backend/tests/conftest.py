"""测试夹具。必须在导入 app 之前设置环境变量，让应用使用临时数据库与目录。"""
import os
import tempfile

_TMP = tempfile.mkdtemp(prefix="aivs-test-")
os.environ.update({
    "APP_ENV": "test",
    "DATABASE_URL": f"sqlite:///{_TMP}/test.db",
    "LOCAL_STORAGE_DIR": f"{_TMP}/storage",
    "VIDEO_PROVIDER": "fake",
    "WORKER_EMBEDDED": "false",
    "AUTO_MIGRATE": "false",  # 测试里表由夹具直接创建
})

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import Settings, get_settings  # noqa: E402

# 测试结果不能依赖开发者本机的 .env（里面可能有真实密钥和不同的限额）
Settings.model_config["env_file"] = None
from app.db.base import Base  # noqa: E402
from app.db.session import engine  # noqa: E402
from app.llm.fake import FakeLLM  # noqa: E402
from app.main import app  # noqa: E402
from app.providers.fake import FakeProvider  # noqa: E402
from app.storage.factory import get_storage  # noqa: E402
from app.workers.pipeline_worker import PipelineWorker  # noqa: E402
from app.workers.video_worker import VideoWorker  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture(autouse=True)
def _fresh_db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def llm_spy():
    """应用内部使用的（缓存的）假 LLM，用来检查 API 调用时实际发出的提示词。"""
    from app.llm.factory import get_llm
    instance = get_llm()
    instance.calls.clear()
    return instance


@pytest.fixture
def provider() -> FakeProvider:
    return FakeProvider(polls_before_done=2)


@pytest.fixture
def llm() -> FakeLLM:
    return FakeLLM()


@pytest.fixture
def make_pipeline(llm):
    """生产流程 Worker（LLM 阶段 + 视频任务状态同步）。"""
    def _make(**overrides) -> PipelineWorker:
        return PipelineWorker(Settings(llm_max_retries=1, **overrides), llm)
    return _make


@pytest.fixture
def account_id(client) -> str:
    """出厂数据里的“视频号 / 女性向情感治愈类账号”（应用启动时写入）。

    出厂配置要求至少 1 张参考图（H3 的 ref_image_0 必填）。大多数测试不关心图片，
    这里把它放宽；“参考图必填”由专门的测试把它改回 True 来验证。
    """
    lines = client.get("/api/v1/business-lines").json()["data"]
    account = lines[0]["account_types"][0]
    body = {"name": account["name"], "persona": account["persona"], "style_guide": account["style_guide"],
            "params": {**account["params"], "requires_image": False}, "is_active": True}
    assert client.put(f"/api/v1/accounts/{account['id']}", json=body).status_code == 200
    return account["id"]


@pytest.fixture
def make_worker(provider):
    """创建轮询间隔为 0 的 Worker，测试里可以连续 run_once 推进任务。"""
    def _make(**overrides) -> VideoWorker:
        settings = Settings(autodl_poll_interval_seconds=0, autodl_poll_max_interval_seconds=0, **overrides)
        return VideoWorker(settings, provider, get_storage())
    return _make


@pytest.fixture
def image_id(client) -> str:
    r = client.post("/api/v1/uploads", files={"file": ("a.png", PNG, "image/png")})
    assert r.status_code == 201, r.text
    return r.json()["data"]["file_id"]


@pytest.fixture
def create_task(client, account_id):
    def _create(**kw):
        # 默认夜间模式会等窗口，测试里默认用立即模式，避免结果依赖当前真实时间
        body = {"account_id": account_id, "prompt": "测试提示词", "run_mode": "now", **kw}
        return client.post("/api/v1/videos", json=body)
    return _create


async def drain(worker: VideoWorker, max_steps: int = 20) -> None:
    """持续推进直到没有可处理的任务。"""
    for _ in range(max_steps):
        if not await worker.run_once():
            return


async def drain_both(video: VideoWorker, pipeline: PipelineWorker, max_steps: int = 60) -> None:
    """同时推进视频 Worker 与生产流程 Worker，直到两边都没有可做的事。"""
    for _ in range(max_steps):
        a = await pipeline.run_once()
        b = await video.run_once()
        if not (a or b):
            return
