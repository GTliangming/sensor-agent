
from app.config import get_settings
from app.graph.nodes.quality import make_supervisor, route_from_supervisor
from app.graph.routing import RouteDecision

_SB = {"title": "t", "hook": "h", "closing_line": "c",
       "scenes": [{"scene_id": "s1", "order": 1, "narration": "n", "visual_prompt": "v",
                   "duration_seconds": 2.0}]}
_RENDER_OK = {"validated": True}


def _supervisor():
    return make_supervisor(get_settings().model_copy(update={"max_storyboard_revisions": 1,
                                                             "max_asset_rechecks": 1}))


def test_pass_continues():
    out = _supervisor()({"task_id": "t", "storyboard": _SB, "render_plan": _RENDER_OK})
    assert out["route_decision"] == str(RouteDecision.CONTINUE)


def test_storyboard_issue_reworks_then_fails():
    sup = _supervisor()
    # 无 storyboard -> storyboard 问题；首次返工
    o1 = sup({"task_id": "t", "retry_counts": {}})
    assert o1["route_decision"] == str(RouteDecision.REVISE_STORYBOARD)
    assert o1["retry_counts"]["storyboard"] == 1
    # 超过上限 -> FAIL 且置 failed
    o2 = sup({"task_id": "t", "retry_counts": {"storyboard": 1}})
    assert o2["route_decision"] == str(RouteDecision.FAIL)
    assert o2["status"] == "failed"


def test_asset_issue_routes_retry():
    sup = _supervisor()
    state = {"task_id": "t", "storyboard": _SB, "render_plan": _RENDER_OK,
             "asset_plan": {"scene_matches": [{"scene_id": "s1", "chosen_asset_id": "img_unknown_license_07"}]},
             "retry_counts": {}}
    out = sup(state)
    assert out["route_decision"] == str(RouteDecision.RETRY_ASSET_SEARCH)


def test_illegal_decision_rejected_to_save_result():
    assert route_from_supervisor({"route_decision": "rm -rf /"}) == "save_result"
    assert route_from_supervisor({"route_decision": "continue"}) == "validate_output"
    assert route_from_supervisor({"route_decision": "revise_storyboard"}) == "generate_storyboard"
