import pytest

from app.config import get_settings
from app.domain.plans import AssetPlan, SceneMatch
from app.domain.request import CreateTaskRequest
from app.domain.storyboard import Scene, Storyboard
from app.providers.image.fake import FakeImageProvider
from app.repositories.sqlite import TaskRepository
from app.services.assets.image_generation import ImageGenerationService


@pytest.mark.asyncio
async def test_over_budget_gaps_get_placeholder(tmp_path):
    settings = get_settings().model_copy(update={"data_dir": str(tmp_path)})
    repo = TaskRepository(tmp_path / "ph.db")
    svc = ImageGenerationService(FakeImageProvider(), repo, settings)
    sb = Storyboard(title="t", hook="h", closing_line="c", scenes=[
        Scene(scene_id="s1", order=1, narration="n1", visual_prompt="p1", duration_seconds=2.0),
        Scene(scene_id="s2", order=2, narration="n2", visual_prompt="p2", duration_seconds=2.0),
    ])
    plan = AssetPlan(task_id="t", producer="r",
                     scene_matches=[SceneMatch(scene_id="s1", order=1, gap=True),
                                    SceneMatch(scene_id="s2", order=2, gap=True)],
                     gaps=["s1", "s2"],
                     stats={"to_generate": ["s1"]})  # 预算只允许生成 1 个
    out = await svc.fill_gaps(sb, CreateTaskRequest(request_id="r", topic="x"), plan)
    assert out.gaps == []  # 全部可渲染
    assert out.stats["generated_count"] == 1
    assert out.stats["placeholder_count"] == 1
    assert all(m.chosen_asset_id for m in out.scene_matches)
