import pytest

from app.config import get_settings
from app.domain.plans import AudioPlan
from app.domain.storyboard import Scene, Storyboard
from app.media_util import write_silence_wav, write_solid_png
from app.repositories.sqlite import TaskRepository
from app.services.media.render_service import RenderService
from app.services.media.subtitle_service import build_srt


@pytest.mark.asyncio
async def test_render_produces_valid_mp4(tmp_path):
    settings = get_settings().model_copy(update={"data_dir": str(tmp_path)})
    repo = TaskRepository(tmp_path / "r.db")
    task_id = "task_render"

    # 准备两张图片资产与两段音频
    storyboard = Storyboard(
        title="t", hook="h", closing_line="c",
        scenes=[
            Scene(scene_id="s1", order=1, narration="第一段", visual_prompt="p1", duration_seconds=2.0),
            Scene(scene_id="s2", order=2, narration="第二段", visual_prompt="p2", duration_seconds=2.0),
        ],
    )
    img1 = tmp_path / "s1.png"; write_solid_png(img1, 64, 114)
    img2 = tmp_path / "s2.png"; write_solid_png(img2, 64, 114)
    repo.upsert_asset({"asset_id": "a1", "asset_type": "image", "source_type": "owned",
                       "commercial_use_allowed": True, "local_path": str(img1)})
    repo.upsert_asset({"asset_id": "a2", "asset_type": "image", "source_type": "owned",
                       "commercial_use_allowed": True, "local_path": str(img2)})
    asset_plan = {"scene_matches": [
        {"scene_id": "s1", "chosen_asset_id": "a1"},
        {"scene_id": "s2", "chosen_asset_id": "a2"},
    ]}

    adir = tmp_path / "tasks" / task_id / "audio"
    a1 = adir / "s1.wav"; write_silence_wav(a1, 1.0)
    a2 = adir / "s2.wav"; write_silence_wav(a2, 1.5)
    audio_plan = AudioPlan(task_id=task_id, producer="tts", segments=[
        {"scene_id": "s1", "order": 1, "text": "第一段", "file_path": str(a1), "duration_seconds": 1.0},
        {"scene_id": "s2", "order": 2, "text": "第二段", "file_path": str(a2), "duration_seconds": 1.5},
    ])
    srt = build_srt(audio_plan, settings.tasks_dir / task_id / "subtitles.srt")

    rp = RenderService(repo, settings).render(task_id, storyboard, asset_plan, audio_plan, str(srt))
    assert rp.validated is True
    assert rp.probe["video"]["width"] == settings.video_width
    assert rp.probe["video"]["height"] == settings.video_height
    assert rp.probe["audio"] is not None
    from pathlib import Path
    assert Path(rp.output_path).exists()
