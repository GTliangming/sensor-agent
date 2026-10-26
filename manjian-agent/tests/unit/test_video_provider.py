import pytest

from app.media_util import write_solid_png
from app.providers.video.fake import FakeVideoProvider
from app.services.media.ffprobe_service import probe_media


@pytest.mark.asyncio
async def test_fake_video_provider_makes_clip_with_audio(tmp_path):
    img = tmp_path / "s.png"; write_solid_png(img, 64, 114)
    out = tmp_path / "clip.mp4"
    await FakeVideoProvider(540, 960, 30).image_to_video(img, "prompt", out_path=out, seconds=2.0)
    probe = probe_media(out)
    assert probe["video"]["width"] == 540 and probe["video"]["height"] == 960
    assert probe["audio"] is not None
    assert 1.5 <= probe["duration"] <= 2.6


def test_fake_provider_declares_audio():
    assert FakeVideoProvider().produces_audio is True
