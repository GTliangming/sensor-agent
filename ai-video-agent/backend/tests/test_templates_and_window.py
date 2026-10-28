"""提示词模板：作用域优先级、变量校验、版本化；夜间窗口计算。"""
from datetime import UTC, datetime
from types import SimpleNamespace as NS

from app.core.config import Settings
from app.scheduling.window import is_window_open, next_window_start
from app.services.template_service import pick_template
from tests.conftest import drain_both

ACC = NS(id="acc-1", platform="wechat_channels")


def _t(version=1, **fields):
    base = dict(account_id=None, video_type=None, platform=None, version=version, name="")
    return NS(**{**base, **fields})


def test_account_scope_beats_video_type_beats_platform():
    generic = _t(name="generic")
    platform = _t(name="platform", platform="wechat_channels")
    vtype = _t(name="vtype", video_type="daily")
    mine = _t(name="mine", account_id="acc-1")
    assert pick_template([generic, platform, vtype, mine], ACC, "daily").name == "mine"
    assert pick_template([generic, platform, vtype], ACC, "daily").name == "vtype"
    assert pick_template([generic, platform], ACC, "daily").name == "platform"
    assert pick_template([generic], ACC, "daily").name == "generic"


def test_template_for_other_scope_is_excluded():
    other_account = _t(account_id="acc-2")
    other_type = _t(video_type="story")
    assert pick_template([other_account, other_type], ACC, "daily") is None


def test_higher_version_wins_within_same_scope():
    assert pick_template([_t(1, name="v1"), _t(2, name="v2")], ACC, "daily").name == "v2"


def test_template_rejects_unknown_variable(client):
    r = client.post("/api/v1/templates", json={"kind": "content", "name": "x", "body": "写 {{topci}}"})
    assert r.status_code == 422 and "topci" in r.json()["message"]


def test_template_update_creates_new_version(client):
    t = client.post("/api/v1/templates", json={"kind": "video_base", "name": "x", "body": "A {{aspect_ratio}}"}).json()["data"]
    new = client.put(f"/api/v1/templates/{t['id']}", json={"name": "x", "body": "B {{aspect_ratio}}"}).json()["data"]
    assert new["version"] == 2 and new["group_id"] == t["group_id"]
    bodies = [a["body"] for a in client.get("/api/v1/templates?kind=video_base").json()["data"]]
    assert "B {{aspect_ratio}}" in bodies and "A {{aspect_ratio}}" not in bodies


def test_seeded_templates_belong_to_the_account_type(client, account_id):
    mine = client.get(f"/api/v1/templates?account_id={account_id}").json()["data"]
    assert sorted(t["kind"] for t in mine) == sorted(
        ["content", "content_user", "topic_suggest", "video_base", "video_character", "video_shot",
         "video_dialogue", "video_negative", "video_negative_line"])
    assert all(t["account_id"] == account_id for t in mine)


async def test_account_template_is_used_in_llm_prompt(client, account_id, make_worker, make_pipeline, llm):
    seeded = client.get(f"/api/v1/templates?kind=content&account_id={account_id}").json()["data"][0]
    client.post("/api/v1/templates", json={"kind": "content", "name": "通用", "body": "通用模板"})
    client.put(f"/api/v1/templates/{seeded['id']}", json={
        "name": "专属", "body": "专属模板：{{account_name}} / {{duration_seconds}}", "account_id": account_id,
    })
    client.post("/api/v1/productions", json={"account_id": account_id, "topic": "雨天", "run_mode": "now"})
    await drain_both(make_worker(), make_pipeline())
    assert llm.calls[0][0] == "专属模板：女性向情感治愈类账号 / 15"  # 账号类型专属模板优先于通用模板


def test_template_meta_lists_kinds_and_defaults(client):
    meta = client.get("/api/v1/templates/meta").json()["data"]
    assert set(meta["kinds"]) == {"content", "content_user", "topic_suggest", "video_base", "video_character",
                                  "video_shot", "video_dialogue", "video_negative", "video_negative_line"}
    assert set(meta["required"]) == {"content", "content_user", "video_base", "video_shot"}
    assert "persona" in meta["variables"] and "aspect_ratio" in meta["variables"]
    assert '"scenes"' in meta["starters"]["content"]  # 起步文本只给编辑器参考，运行时不读


def _utc(h, m=0):
    return datetime(2026, 10, 28, h, m, tzinfo=UTC)


def test_overnight_window_in_shanghai_time():
    s = Settings(generation_window_start="23:00", generation_window_end="07:00")
    assert is_window_open(_utc(15, 0), s)  # 北京 23:00
    assert is_window_open(_utc(20, 0), s)  # 北京 04:00
    assert not is_window_open(_utc(23, 30), s)  # 北京 07:30
    assert not is_window_open(_utc(4, 0), s)  # 北京 12:00


def test_next_window_start():
    s = Settings(generation_window_start="23:00", generation_window_end="07:00")
    assert next_window_start(_utc(4, 0), s) == _utc(15, 0)  # 北京中午 -> 当晚 23:00
    now_open = _utc(16, 0)
    assert next_window_start(now_open, s) == now_open


def test_window_disabled_is_always_open():
    assert is_window_open(_utc(4, 0), Settings(generation_window_enabled=False))
