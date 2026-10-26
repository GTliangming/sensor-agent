import pytest

from app.domain.plans import AudioPlan
from app.providers.tts.base import text_hash
from app.providers.tts.fake import FakeTTSProvider
from app.services.media.ffprobe_service import probe_duration
from app.services.media.subtitle_service import _ts, build_srt


@pytest.mark.asyncio
async def test_fake_tts_duration_scales_with_text(tmp_path):
    p = FakeTTSProvider()
    short = tmp_path / "s.wav"
    long = tmp_path / "l.wav"
    await p.synthesize("短", out_path=short, voice="v", speed=1.0)
    await p.synthesize("这是一段明显更长的中文旁白文本用于验证时长更长", out_path=long, voice="v", speed=1.0)
    assert probe_duration(long) > probe_duration(short)


def test_srt_timestamp_format():
    assert _ts(0) == "00:00:00,000"
    assert _ts(3.5) == "00:00:03,500"
    assert _ts(3661.25) == "01:01:01,250"


def test_build_srt_cumulative_timeline(tmp_path):
    plan = AudioPlan(
        task_id="t", producer="p",
        segments=[
            {"scene_id": "s1", "order": 1, "text": "第一句", "duration_seconds": 2.0},
            {"scene_id": "s2", "order": 2, "text": "第二句", "duration_seconds": 3.0},
        ],
    )
    out = build_srt(plan, tmp_path / "subs.srt")
    content = out.read_text(encoding="utf-8")
    assert "00:00:00,000 --> 00:00:02,000" in content
    assert "00:00:02,000 --> 00:00:05,000" in content
    assert "第一句" in content and "第二句" in content


def test_text_hash_stable():
    assert text_hash(" hello ") == text_hash("hello")
