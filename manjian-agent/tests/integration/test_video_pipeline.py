import pytest

from app.config import get_settings
from app.domain.plans import AudioPlan
from app.domain.storyboard import Scene, Storyboard
from app.media_util import write_silence_wav, write_solid_png
from app.providers.video.fake import FakeVideoProvider
from app.repositories.sqlite import TaskRepository
from app.services.media.ffprobe_service import probe_duration
from app.services.media.video_service import VideoClipService


def _setup(tmp_path):
    settings = get_settings().model_copy(update={"data_dir": str(tmp_path), "video_clip_seconds": 3.0})
    repo = TaskRepository(tmp_path / "v.db")
    img = tmp_path / "s1.png"; write_solid_png(img, 64, 114)
    repo.upsert_asset({"asset_id": "a1", "asset_type": "image", "source_type": "owned",
                       "commercial_use_allowed": True, "local_path": str(img)})
    sb = Storyboard(title="t", hook="h", closing_line="c",
                    scenes=[Scene(scene_id="s1", order=1, narration="沙漠骆驼",
                                  visual_prompt="沙漠 骆驼", duration_seconds=2.0)])
    asset_plan = {"scene_matches": [{"scene_id": "s1", "chosen_asset_id": "a1"}]}
    svc = VideoClipService(FakeVideoProvider(settings.video_width, settings.video_height, settings.video_fps),
                           repo, settings)
    return settings, svc, sb, asset_plan


@pytest.mark.asyncio
async def test_clip_video_audio_mode_uses_native_duration(tmp_path):
    _s, svc, sb, ap = _setup(tmp_path)
    clips = await svc.build("task_v", sb, ap, audio_plan=None, use_tts=False)
    assert len(clips) == 1
    # 视频音轨模式：时长取视频原生时长（≈clip_seconds=3）
    assert 2.5 <= clips[0]["duration"] <= 3.5
    assert 2.5 <= probe_duration(__import__("pathlib").Path(clips[0]["clip_path"])) <= 3.5


@pytest.mark.asyncio
async def test_clip_tts_mode_fits_narration_duration(tmp_path):
    settings, svc, sb, ap = _setup(tmp_path)
    wav = tmp_path / "s1.wav"; write_silence_wav(wav, 1.5)
    audio_plan = AudioPlan(task_id="task_v2", producer="tts", segments=[
        {"scene_id": "s1", "order": 1, "text": "沙漠骆驼", "file_path": str(wav), "duration_seconds": 1.5}])
    clips = await svc.build("task_v2", sb, ap, audio_plan=audio_plan, use_tts=True)
    # TTS 模式：视频裁到旁白时长（1.5s，<clip_seconds）
    assert abs(clips[0]["duration"] - 1.5) < 0.3
