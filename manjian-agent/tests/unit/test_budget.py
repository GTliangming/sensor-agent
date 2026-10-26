import pytest

from app.config import get_settings
from app.graph.nodes.storyboard import make_generate_storyboard
from app.providers.text.fake import FakeTextProvider


@pytest.mark.asyncio
async def test_storyboard_refuses_when_llm_budget_exhausted():
    node = make_generate_storyboard(FakeTextProvider(),
                                    get_settings().model_copy(update={"max_llm_calls": 2}))
    state = {"task_id": "t", "request": {"request_id": "r", "topic": "x"}, "llm_calls": 2}
    out = await node(state)
    assert out["status"] == "failed"
    assert out["errors"][0]["code"] == "resource_limit"


@pytest.mark.asyncio
async def test_storyboard_counts_llm_calls():
    node = make_generate_storyboard(FakeTextProvider(),
                                    get_settings().model_copy(update={"max_llm_calls": 4}))
    out = await node({"task_id": "t", "request": {"request_id": "r", "topic": "城市"}, "llm_calls": 0})
    assert out.get("storyboard")
    assert out["llm_calls"] == 1  # fake 一次成功
