import pytest

from app.config import get_settings
from app.graph.single_graph import build_single_graph
from app.graph.state import TaskStatus
from app.providers.image.fake import FakeImageProvider
from app.providers.text.fake import FakeTextProvider
from app.providers.tts.fake import FakeTTSProvider
from app.repositories.sqlite import TaskRepository


@pytest.mark.asyncio
async def test_graph_runs_end_to_end_to_succeeded(tmp_path):
    repo = TaskRepository(tmp_path / "e2e.db")
    settings = get_settings().model_copy(update={"data_dir": str(tmp_path)})
    graph = build_single_graph(
        provider=FakeTextProvider(), settings=settings, repo=repo,
        image_provider=FakeImageProvider(), tts_provider=FakeTTSProvider(),
    )
    state = {
        "task_id": "task_e2e",
        "request": {"request_id": "req_e2e", "topic": "城市夜景", "target_seconds": 12,
                    "max_generated_images": 8},
        "status": TaskStatus.QUEUED,
        "errors": [],
    }
    final = await graph.ainvoke(state)
    assert final["status"] == TaskStatus.SUCCEEDED
    assert final["stage"] == "done"
    rp = final["render_plan"]
    assert rp["validated"] is True
    assert rp["output_path"].endswith("output.mp4")
    assert rp["probe"]["video"]["width"] == settings.video_width
    assert rp["probe"]["audio"] is not None


@pytest.mark.asyncio
async def test_graph_fails_on_invalid_request(tmp_path):
    repo = TaskRepository(tmp_path / "bad.db")
    settings = get_settings().model_copy(update={"data_dir": str(tmp_path)})
    graph = build_single_graph(
        provider=FakeTextProvider(), settings=settings, repo=repo,
        image_provider=FakeImageProvider(), tts_provider=FakeTTSProvider(),
    )
    state = {
        "task_id": "task_bad",
        "request": {"request_id": "req_bad", "topic": ""},
        "status": TaskStatus.QUEUED,
        "errors": [],
    }
    final = await graph.ainvoke(state)
    assert final["status"] == TaskStatus.FAILED
    assert final.get("render_plan") is None
    codes = {e["code"] for e in final["errors"]}
    assert "invalid_input" in codes
