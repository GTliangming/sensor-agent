import pytest

from app.config import get_settings
from app.domain.request import CreateTaskRequest
from app.graph.single_graph import build_single_graph
from app.graph.state import TaskStatus
from app.providers.text.fake import FakeTextProvider
from app.repositories.sqlite import TaskRepository
from app.services.assets.asset_seed import seed_demo_assets


@pytest.mark.asyncio
async def test_graph_produces_asset_plan_with_hits(tmp_path):
    db = tmp_path / "assets.db"
    repo = TaskRepository(db)
    seeded = seed_demo_assets(repo, force=True)
    assert seeded == 8

    graph = build_single_graph(provider=FakeTextProvider(), settings=get_settings(), repo=repo)
    state = {
        "task_id": "task_assets",
        "request": CreateTaskRequest(request_id="req_assets", topic="城市", target_seconds=12).model_dump(),
        "status": TaskStatus.QUEUED,
        "errors": [],
    }
    final = await graph.ainvoke(state)

    assert final["status"] == TaskStatus.SUCCEEDED
    ap = final["asset_plan"]
    assert ap["stats"]["excluded_unlicensed"] == 2  # 两条无授权素材被过滤
    assert ap["stats"]["pool_size"] == 6
    assert ap["stats"]["hit_count"] >= 1
    # 被选中的素材必须来自可商用池，绝不包含无授权样本
    chosen = {m["chosen_asset_id"] for m in ap["scene_matches"] if m["chosen_asset_id"]}
    assert "img_unknown_license_07" not in chosen
    assert "img_licensed_no_evidence_08" not in chosen
