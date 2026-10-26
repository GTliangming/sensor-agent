import pytest

from app.domain.request import CreateTaskRequest
from app.domain.storyboard import Storyboard
from app.providers.text.fake import FakeTextProvider


@pytest.mark.asyncio
async def test_fake_provider_produces_valid_storyboard():
    req = CreateTaskRequest(request_id="r1", topic="猫咪的一天", target_seconds=15, max_scenes=8)
    raw = await FakeTextProvider().generate_storyboard(req)
    sb = Storyboard.model_validate(raw)  # 不抛即为结构合法
    assert 1 <= len(sb.scenes) <= req.max_scenes
    assert [s.order for s in sb.scenes] == list(range(1, len(sb.scenes) + 1))


@pytest.mark.asyncio
async def test_fake_provider_is_deterministic():
    req = CreateTaskRequest(request_id="r2", topic="咖啡", target_seconds=12)
    a = await FakeTextProvider().generate_storyboard(req)
    b = await FakeTextProvider().generate_storyboard(req)
    assert a == b
