import pytest

from app.config import get_settings
from app.domain.plans import AssetPlan, SceneMatch
from app.domain.request import CreateTaskRequest
from app.domain.storyboard import Scene, Storyboard
from app.providers.image.fake import FakeImageProvider
from app.repositories.sqlite import TaskRepository
from app.services.assets.image_generation import ImageGenerationService


def _storyboard():
    scenes = [
        Scene(scene_id="s1", order=1, narration="沙漠", visual_prompt="沙漠 骆驼",
              duration_seconds=2.0, tags=["沙漠"]),
        Scene(scene_id="s2", order=2, narration="绿洲", visual_prompt="绿洲 棕榈",
              duration_seconds=2.0, tags=["绿洲"]),
    ]
    return Storyboard(title="t", hook="h", closing_line="c", scenes=scenes)


def _plan_with_gaps(task_id="t1"):
    return AssetPlan(
        task_id=task_id, producer="asset_retrieval",
        scene_matches=[
            SceneMatch(scene_id="s1", order=1, gap=True),
            SceneMatch(scene_id="s2", order=2, gap=True),
        ],
        gaps=["s1", "s2"],
        stats={"hit_count": 0, "to_generate": ["s1", "s2"]},
    )


def _service(tmp_path):
    # 用独立的 data_dir，隔离各测试的图片缓存目录
    settings = get_settings().model_copy(update={"data_dir": str(tmp_path)})
    repo = TaskRepository(tmp_path / "img.db")
    return ImageGenerationService(FakeImageProvider(), repo, settings), repo


@pytest.mark.asyncio
async def test_fill_gaps_generates_and_persists(tmp_path):
    svc, repo = _service(tmp_path)
    plan = await svc.fill_gaps(_storyboard(), CreateTaskRequest(request_id="r", topic="沙漠"), _plan_with_gaps())
    assert plan.stats["generated_count"] == 2
    assert plan.gaps == []
    for m in plan.scene_matches:
        assert m.gap is False and m.chosen_asset_id.startswith("gen_")
    gen = [a for a in repo.list_assets("image") if a["source_type"] == "generated"]
    assert len(gen) == 2
    assert all(a["content_hash"].startswith("sha256:") for a in gen)


@pytest.mark.asyncio
async def test_fill_gaps_uses_cache_on_second_run(tmp_path):
    svc, _ = _service(tmp_path)
    req = CreateTaskRequest(request_id="r", topic="沙漠")
    first = await svc.fill_gaps(_storyboard(), req, _plan_with_gaps("t1"))
    assert first.stats["generation_cache_hits"] == 0
    second = await svc.fill_gaps(_storyboard(), req, _plan_with_gaps("t2"))
    assert second.stats["generation_cache_hits"] == 2
