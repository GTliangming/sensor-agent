import pytest

from app.config import get_settings
from app.domain.request import CreateTaskRequest
from app.graph.multi_agent_graph import build_multi_agent_graph
from app.graph.state import TaskStatus
from app.repositories.sqlite import TaskRepository
from app.services.assets.asset_seed import seed_demo_assets


@pytest.mark.asyncio
async def test_multi_agent_graph_passes_quality_and_succeeds(tmp_path):
    settings = get_settings().model_copy(update={"data_dir": str(tmp_path)})
    repo = TaskRepository(tmp_path / "m.db")
    seed_demo_assets(repo, force=True)
    graph = build_multi_agent_graph(settings=settings, repo=repo)
    state = {
        "task_id": "task_multi",
        "request": CreateTaskRequest(request_id="req_multi", topic="城市", target_seconds=8,
                                     max_scenes=3, max_generated_images=3).model_dump(),
        "status": TaskStatus.QUEUED,
        "errors": [],
    }
    final = await graph.ainvoke(state)
    assert final["status"] == TaskStatus.SUCCEEDED
    assert final["quality_report"]["passed"] is True
    assert final["route_decision"] == "continue"
    assert final["render_plan"]["validated"] is True
