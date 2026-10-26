from app.domain.assets import Asset
from app.domain.request import CreateTaskRequest
from app.domain.storyboard import Scene, Storyboard
from app.services.assets.asset_retrieval import AssetRetriever, score_asset


def _scene(sid="s1", order=1, tags=None, prompt="城市 夜景 雨 街道"):
    return Scene(scene_id=sid, order=order, narration="雨后的城市街道",
                 visual_prompt=prompt, duration_seconds=2.0, mood="calm",
                 tags=tags or ["城市", "夜景", "雨"])


def _sb(scenes):
    return Storyboard(title="t", hook="h", closing_line="c", scenes=scenes)


def _req():
    return CreateTaskRequest(request_id="r", topic="城市夜景")


def _licensed(aid, tags, quality=0.8, usage=0):
    return Asset(asset_id=aid, asset_type="image", source_type="licensed",
                 commercial_use_allowed=True, license_evidence_url="https://e.test/x",
                 aspect_ratio="9:16", tags=tags, mood="calm",
                 quality_score=quality, usage_count=usage)


def test_unlicensed_excluded_even_if_high_quality():
    # 授权未知但质量极高、标签完全匹配的素材，必须被过滤，不能被选中
    good = _licensed("ok", ["城市", "夜景", "雨"], quality=0.7)
    unknown = Asset(asset_id="bad_unknown", asset_type="image", source_type="licensed",
                    commercial_use_allowed=False, aspect_ratio="9:16",
                    tags=["城市", "夜景", "雨"], mood="calm", quality_score=0.99)
    no_evidence = Asset(asset_id="bad_noevidence", asset_type="image", source_type="licensed",
                        commercial_use_allowed=True, license_evidence_url="",
                        aspect_ratio="9:16", tags=["城市", "夜景", "雨"],
                        mood="calm", quality_score=0.99)

    plan = AssetRetriever([good, unknown, no_evidence]).match(_sb([_scene()]), _req(), "t1")
    assert plan.stats["pool_size"] == 1
    assert plan.stats["excluded_unlicensed"] == 2
    chosen = {m.chosen_asset_id for m in plan.scene_matches}
    assert chosen == {"ok"}
    assert "bad_unknown" not in {c.asset_id for m in plan.scene_matches for c in m.candidates}


def test_hit_and_gap():
    match_asset = _licensed("match", ["城市", "夜景", "雨"])
    unrelated = _licensed("forest", ["森林", "清晨", "阳光"])
    scenes = [
        _scene("s1", 1, tags=["城市", "夜景"], prompt="城市 夜景"),
        _scene("s2", 2, tags=["沙漠", "骆驼"], prompt="沙漠 骆驼 黄沙"),
    ]
    plan = AssetRetriever([match_asset, unrelated]).match(_sb(scenes), _req(), "t2")
    m1 = next(m for m in plan.scene_matches if m.scene_id == "s1")
    m2 = next(m for m in plan.scene_matches if m.scene_id == "s2")
    assert m1.gap is False and m1.chosen_asset_id == "match"
    assert m2.gap is True and m2.chosen_asset_id is None
    assert "s2" in plan.gaps


def test_empty_pool_all_gaps():
    plan = AssetRetriever([]).match(_sb([_scene()]), _req(), "t3")
    assert plan.stats["hit_count"] == 0
    assert plan.gaps == ["s1"]


def test_score_breakdown_keys():
    _, bd = score_asset(_scene(), _licensed("a", ["城市", "夜景"]))
    assert set(bd) == {"tag", "semantic", "aspect_ratio", "quality", "freshness"}
