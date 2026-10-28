"""创建接口、校验、幂等、列表与详情、业务线与账号类型的数据库配置。"""
import copy

from app.db.session import SessionLocal
from app.models import Account
from app.seed import ensure_defaults


def _account(client, account_id):
    return client.get(f"/api/v1/accounts/{account_id}").json()["data"]


def _put(client, account_id, **changes):
    t = _account(client, account_id)
    body = {"name": t["name"], "persona": t["persona"], "style_guide": t["style_guide"], "params": t["params"],
            "is_active": True, **changes}
    return client.put(f"/api/v1/accounts/{account_id}", json=body)


def test_health(client):
    assert client.get("/api/v1/health").json()["data"]["status"] == "healthy"
    assert client.get("/api/v1/health/ready").status_code == 200


def test_create_returns_202_and_pending(create_task):
    r = create_task()
    assert r.status_code == 202
    data = r.json()["data"]
    assert data["status"] == "pending" and data["task_id"]


def test_validation_errors(client, create_task, image_id):
    assert client.post("/api/v1/videos", json={}).status_code == 422
    assert create_task(duration_seconds=999).status_code == 422  # 超过账号类型配置的 15 秒上限
    assert create_task(resolution="999p").status_code == 422
    assert create_task(account_id="nope").status_code == 422
    assert create_task(image_ids=["missing"]).status_code == 422  # 图片不存在
    assert create_task(image_ids=[image_id, image_id]).status_code == 422  # 重复
    assert create_task(image_ids=["x"] * 9).status_code == 422  # 超过账号类型配置的上限 8 张
    assert create_task(duration_seconds=999).json()["code"] == "VALIDATION_ERROR"


def test_images_are_optional_and_up_to_eight(client, create_task):
    ids = []
    for _ in range(8):
        r = client.post("/api/v1/uploads", files={"file": ("a.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 32, "image/png")})
        ids.append(r.json()["data"]["file_id"])
    assert create_task().status_code == 202  # 不带图片也可以
    r = create_task(image_ids=ids)
    assert r.status_code == 202
    detail = client.get(f"/api/v1/videos/{r.json()['data']['task_id']}").json()["data"]
    assert len(detail["input_image_urls"]) == 8


def test_upload_rejects_non_image(client):
    r = client.post("/api/v1/uploads", files={"file": ("a.png", b"not an image", "image/png")})
    assert r.status_code == 422


def test_idempotency_key_returns_same_task(client, account_id):
    body = {"account_id": account_id, "prompt": "p"}
    h = {"Idempotency-Key": "abc-123"}
    a = client.post("/api/v1/videos", json=body, headers=h).json()["data"]["task_id"]
    b = client.post("/api/v1/videos", json=body, headers=h).json()["data"]["task_id"]
    assert a == b
    assert client.get("/api/v1/videos").json()["data"]["total"] == 1


def test_active_task_quota(client, account_id, monkeypatch):
    from app.core.config import get_settings
    monkeypatch.setattr(get_settings(), "max_active_tasks", 1)
    body = {"account_id": account_id, "prompt": "p"}
    assert client.post("/api/v1/videos", json=body).status_code == 202
    assert client.post("/api/v1/videos", json=body).status_code == 429


def test_list_and_detail(client, create_task):
    tid = create_task(resolution="768p竖", seed=42).json()["data"]["task_id"]
    items = client.get("/api/v1/videos?status=pending").json()["data"]["items"]
    assert [i["task_id"] for i in items] == [tid] and items[0]["queue_position"] == 1
    detail = client.get(f"/api/v1/videos/{tid}").json()["data"]
    assert detail["events"][0]["event_type"] == "task_created"
    assert detail["resolution"] == "768p竖" and detail["aspect_ratio"] == "9:16" and detail["seed"] == 42
    assert "provider_task_id" not in detail
    assert client.get("/api/v1/videos/unknown").status_code == 404
    assert client.get(f"/api/v1/videos/{tid}/result").status_code == 409


def test_queue_position_follows_creation_order(client, create_task):
    ids = [create_task().json()["data"]["task_id"] for _ in range(3)]
    positions = [client.get(f"/api/v1/videos/{t}").json()["data"]["queue_position"] for t in ids]
    assert positions == [1, 2, 3]


def test_business_line_and_account_type_carry_their_config_from_the_database(client):
    lines = client.get("/api/v1/business-lines").json()["data"]
    assert [bl["name"] for bl in lines] == ["视频号"]
    types = lines[0]["account_types"]
    assert [t["name"] for t in types] == ["女性向情感治愈类账号"]
    cfg = types[0]["params"]  # 前端选了业务线和账号类型，就能拿到这一份配置
    assert cfg["seed"] == 683072603085674
    assert [r["label"] for r in cfg["resolutions"]] == ["480p横", "480p竖", "768p横", "768p竖", "480p(1:1)", "768p(1:1)"]
    assert cfg["max_duration"] == 15 and cfg["max_images"] == 8 and cfg["max_audios"] == 3 and cfg["audio_enabled"] is False


def test_changing_config_in_the_database_changes_validation(client, create_task, account_id):
    """规则在库里：把时长上限改成 8 秒、去掉 768 的选项，校验立刻按新配置走，不需要改代码。"""
    cfg = copy.deepcopy(_account(client, account_id)["params"])
    cfg.update(max_duration=8, default_duration=8, max_images=2)
    cfg["resolutions"] = [r for r in cfg["resolutions"] if r["label"].startswith("480p")]
    assert _put(client, account_id, params=cfg).status_code == 200
    assert create_task(duration_seconds=10).status_code == 422
    assert create_task(resolution="768p竖").status_code == 422
    assert create_task(image_ids=["a", "b", "c"]).status_code == 422
    assert create_task(duration_seconds=8, resolution="480p横").status_code == 202


def test_new_task_uses_seed_stored_in_the_database(client, create_task, account_id):
    cfg = _account(client, account_id)["params"] | {"seed": 4242}
    assert _put(client, account_id, params=cfg).status_code == 200
    tid = create_task().json()["data"]["task_id"]
    assert client.get(f"/api/v1/videos/{tid}").json()["data"]["seed"] == 4242


def test_invalid_config_is_rejected_with_a_readable_message(client, account_id):
    cfg = _account(client, account_id)["params"]
    assert _put(client, account_id, params={**cfg, "seed": "abc"}).status_code == 422
    r = _put(client, account_id, params={**cfg, "min_duration": 20})
    assert r.status_code == 422 and "时长" in r.json()["message"]
    assert _put(client, account_id, params={**cfg, "default_resolution": "不存在"}).status_code == 422


def test_seed_is_idempotent_and_keeps_edits(client, account_id):
    cfg = _account(client, account_id)["params"] | {"seed": 1234}
    assert _put(client, account_id, params=cfg).status_code == 200
    with SessionLocal() as db:
        ensure_defaults(db)  # 再次启动不会把后台改过的 seed 还原
    assert _account(client, account_id)["params"]["seed"] == 1234
    assert len(client.get("/api/v1/business-lines").json()["data"][0]["account_types"]) == 1


def test_seed_fills_only_missing_config_keys_on_upgrade(client, account_id):
    with SessionLocal() as db:
        a = db.get(Account, account_id)
        a.params = {"seed": 99}  # 旧版本只存了 seed
        db.commit()
        ensure_defaults(db)
    cfg = _account(client, account_id)["params"]
    assert cfg["seed"] == 99 and len(cfg["resolutions"]) == 6  # 缺的补上，已有的不动


def test_manual_task_negative_prompt_is_sent_inside_the_single_prompt(client, create_task):
    """手动任务的负向提示词同样要一并发送：没有负向字段时按「负向写法」拼进 prompt。"""
    tid = create_task(prompt="a cat", negative_prompt="blurry, watermark").json()["data"]["task_id"]
    d = client.get(f"/api/v1/videos/{tid}").json()["data"]
    assert d["prompt"] == "a cat Negative prompt (avoid all of these): blurry, watermark"
    assert d["negative_prompt"] is None


def test_manual_negative_goes_to_its_own_field_when_configured(client, create_task, account_id):
    cfg = _account(client, account_id)["params"]
    cfg["fields"]["negative_prompt"] = "neg"
    assert _put(client, account_id, params=cfg).status_code == 200
    tid = create_task(prompt="a cat", negative_prompt="blurry").json()["data"]["task_id"]
    d = client.get(f"/api/v1/videos/{tid}").json()["data"]
    assert d["prompt"] == "a cat" and d["negative_prompt"] == "blurry"


def test_manual_negative_without_any_route_is_rejected(client, create_task, account_id):
    line = client.get(f"/api/v1/templates?kind=video_negative_line&account_id={account_id}").json()["data"][0]
    client.delete(f"/api/v1/templates/{line['id']}")
    r = create_task(prompt="a cat", negative_prompt="blurry")
    assert r.status_code == 422 and "负向" in r.json()["message"]
    assert create_task(prompt="a cat").status_code == 202  # 没填负向提示词就不受影响


def test_seed_upgrade_applies_official_h3_fields_once_and_fills_blank_workflow_id(client, account_id, monkeypatch):
    from app.core.config import get_settings
    monkeypatch.setattr(get_settings(), "autodl_workflow_id", "minimax_h3_zm_u24")
    with SessionLocal() as db:
        a = db.get(Account, account_id)
        # 上一版出厂配置：猜测的字段名，没有 config_version，工作流 ID 为空
        a.params = {**a.params, "config_version": 1, "workflow_id": "", "requires_image": False,
                    "fields": {"prompt": "prompt", "images": "", "image_mode": "base64"}}
        db.commit()
        ensure_defaults(db)
    cfg = _account(client, account_id)["params"]
    assert cfg["fields"]["images"] == "ref_image_" and cfg["fields"]["image_mode"] == "url"
    assert cfg["requires_image"] is True and cfg["config_version"] == 2
    assert cfg["workflow_id"] == "minimax_h3_zm_u24"

    # 升级只发生一次：之后用户改成什么，重启都不会再被覆盖
    edited = {**cfg, "requires_image": False, "workflow_id": "my-own-workflow"}
    assert _put(client, account_id, params=edited).status_code == 200
    with SessionLocal() as db:
        ensure_defaults(db)
    again = _account(client, account_id)["params"]
    assert again["requires_image"] is False and again["workflow_id"] == "my-own-workflow"


def test_copy_account_type_copies_config_and_templates(client, account_id):
    r = client.post("/api/v1/accounts", json={
        "platform": "wechat_channels", "slug": "calm_life", "name": "治愈生活类", "persona": "安静的生活记录",
        "copy_from": account_id})
    assert r.status_code == 201, r.text
    new = r.json()["data"]
    assert new["params"]["seed"] == _account(client, account_id)["params"]["seed"]
    mine = client.get(f"/api/v1/templates?account_id={new['id']}").json()["data"]
    assert sorted(t["kind"] for t in mine) == sorted(
        ["content", "content_user", "topic_suggest", "video_base", "video_character", "video_shot",
         "video_dialogue", "video_negative", "video_negative_line"])
    assert all(t["account_id"] == new["id"] for t in mine)
    # 改新类型的配置不影响原来的
    assert _put(client, new["id"], params=new["params"] | {"seed": 5}).status_code == 200
    assert _account(client, account_id)["params"]["seed"] == 683072603085674
    assert client.post("/api/v1/accounts", json={
        "platform": "wechat_channels", "slug": "calm_life", "name": "重复", "persona": "x", "copy_from": account_id,
    }).status_code == 422


def test_suggest_topic_uses_the_topic_template_in_the_database(client, account_id, llm_spy):
    r = client.post(f"/api/v1/accounts/{account_id}/suggest-topic")
    assert r.status_code == 200 and r.json()["data"]["topic"]
    system = llm_spy.calls[-1][0]
    assert "女性清醒成长" in system and "温暖治愈加清醒恋爱观" in system  # 来自库里的模板，人设变量已渲染
