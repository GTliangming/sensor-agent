import pytest
from pydantic import ValidationError

from app.domain.storyboard import Scene, Storyboard


def _scene(order: int, sid: str) -> Scene:
    return Scene(
        scene_id=sid, order=order, narration="旁白", visual_prompt="画面", duration_seconds=2.0
    )


def test_valid_storyboard():
    sb = Storyboard(
        title="t", hook="h", closing_line="c",
        scenes=[_scene(1, "s1"), _scene(2, "s2")],
    )
    assert sb.total_duration == 4.0
    assert len(sb.scenes) == 2


def test_order_must_be_continuous():
    with pytest.raises(ValidationError):
        Storyboard(title="t", hook="h", closing_line="c",
                   scenes=[_scene(1, "s1"), _scene(3, "s2")])


def test_scene_id_must_be_unique():
    with pytest.raises(ValidationError):
        Storyboard(title="t", hook="h", closing_line="c",
                   scenes=[_scene(1, "s1"), _scene(2, "s1")])


def test_duration_upper_bound():
    with pytest.raises(ValidationError):
        Scene(scene_id="s", order=1, narration="n", visual_prompt="v", duration_seconds=99)
