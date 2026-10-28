"""生产流程：LLM 一次生成内容，三个强制审核点、人工打断、夜间窗口、失败与重试。"""
from sqlalchemy import select

from app.db.session import SessionLocal
from app.llm.base import LLMError
from app.models import VideoTask
from tests.conftest import drain, drain_both

P = "/api/v1/productions"


def _create(client, account_id, run_mode="now", **kw):
    body = {"account_id": account_id, "topic": "停止内耗", "run_mode": run_mode, "duration_seconds": 15, **kw}
    r = client.post(P, json=body)
    assert r.status_code == 202, r.text
    return r.json()["data"]["id"]


def _detail(client, pid):
    return client.get(f"{P}/{pid}").json()["data"]


def _task(pid) -> VideoTask:
    with SessionLocal() as db:
        return db.scalar(select(VideoTask).where(VideoTask.production_id == pid).order_by(VideoTask.created_at.desc()))


async def _to_queued(client, pid, vw, pw, scene_edit=None, dialogue_edit=None):
    await drain_both(vw, pw)
    assert client.post(f"{P}/{pid}/scene/approve", json=scene_edit or {}).status_code == 200
    assert client.post(f"{P}/{pid}/dialogue/approve", json=dialogue_edit or {}).status_code == 200


async def test_full_flow_with_three_mandatory_reviews(client, account_id, make_worker, make_pipeline):
    vw, pw = make_worker(), make_pipeline()
    pid = _create(client, account_id)
    assert _detail(client, pid)["status"] == "scene_generating"

    # 审核 A：分镜。LLM 生成后必须停在审核，不会自己往下走
    await drain_both(vw, pw)
    d = _detail(client, pid)
    assert d["status"] == "scene_review" and d["content"]["source"] == "llm"
    assert len(d["content"]["content"]["scenes"]) == 3 and "approve_scene" in d["allowed_actions"]
    assert client.post(f"{P}/{pid}/dialogue/approve", json={}).status_code == 409  # 不能跳过审核 A
    assert client.post(f"{P}/{pid}/scene/approve", json={}).status_code == 200

    # 审核 B：台词与字幕
    d = _detail(client, pid)
    assert d["status"] == "dialogue_review" and d["content"]["content"]["tts_text"]
    assert client.post(f"{P}/{pid}/dialogue/approve", json={}).status_code == 200
    assert _detail(client, pid)["status"] == "queued"

    # 视频生成后必须停在审核 C
    await drain_both(vw, pw)
    d = _detail(client, pid)
    assert d["status"] == "video_review" and d["video"]["video_url"]
    assert d["video"]["elapsed_seconds"] is not None
    assert client.post(f"{P}/{pid}/published").status_code == 409  # 未通过成片审核不能发布

    assert client.post(f"{P}/{pid}/video/approve").status_code == 200
    assert client.post(f"{P}/{pid}/published").status_code == 200
    d = _detail(client, pid)
    assert d["status"] == "published"
    assert [r["action"] for r in d["reviews"]] == ["approve", "approve", "approve", "published"]


async def test_video_prompt_is_assembled_from_templates_and_reviewed_content(client, account_id, make_worker, make_pipeline):
    vw, pw = make_worker(), make_pipeline()
    pid = _create(client, account_id, resolution="768p横", duration_seconds=15)
    scenes = [{"scene_id": i, "scene_desc": f"edited scene {i}", "action_desc": f"edited action {i}",
               "camera_desc": f"edited camera {i}"} for i in (1, 2, 3)]
    await _to_queued(client, pid, vw, pw, {"scenes": scenes}, {"tts_text": "人工改过的台词"})

    t = _task(pid)
    # 公式：全局前缀 + 固定角色 + 各镜头；画幅取自所选视频方向，而不是写死 16:9
    assert t.prompt.startswith("(masterpiece, best quality:1.2), strict 16:9 aspect ratio, 2D anime")
    assert "A cute chibi girl with round glasses" in t.prompt
    assert "Shot 1 (0-5s): edited scene 1 edited action 1 edited camera 1" in t.prompt
    assert "Shot 3 (10-15s): edited scene 3" in t.prompt
    # 接口只有一个 prompt 字段：台词、负向提示词都按各自的模板拼进同一个 prompt，一并发送
    assert 'The character says in Mandarin Chinese: "人工改过的台词"' in t.prompt
    assert "Negative prompt (avoid all of these): (worst quality, low quality:1.4)" in t.prompt
    assert t.prompt.rstrip().endswith("3d render.")  # 负向在最后，原文完整
    assert t.dialogue is None and t.negative_prompt is None  # 都已经在 prompt 里，不再单独传
    assert t.resolution == "768p横" and t.aspect_ratio == "16:9"
    d = _detail(client, pid)
    assert d["content"]["version"] == 3 and d["content"]["source"] == "human"  # 两次人工修改各一个版本


async def test_negative_goes_to_its_own_field_when_the_config_has_one(client, account_id, make_worker, make_pipeline):
    acc = client.get(f"/api/v1/accounts/{account_id}").json()["data"]
    params = {**acc["params"], "fields": {**acc["params"]["fields"], "negative_prompt": "neg"}}
    client.put(f"/api/v1/accounts/{account_id}", json={"name": acc["name"], "persona": acc["persona"],
                                                        "style_guide": None, "params": params, "is_active": True})
    pid = _create(client, account_id)
    await _to_queued(client, pid, make_worker(), make_pipeline())
    t = _task(pid)
    assert t.negative_prompt.startswith("(worst quality") and "Negative prompt" not in t.prompt


def test_negative_without_any_route_is_rejected_up_front(client, account_id):
    line = _template(client, account_id, "video_negative_line")
    client.delete(f"/api/v1/templates/{line['id']}")
    r = client.post(P, json={"account_id": account_id, "topic": "t", "run_mode": "now"})
    assert r.status_code == 422 and "负向" in r.json()["message"]


async def test_dialogue_goes_to_its_own_field_when_the_config_has_one(client, account_id, make_worker, make_pipeline):
    acc = client.get(f"/api/v1/accounts/{account_id}").json()["data"]
    params = {**acc["params"], "fields": {**acc["params"]["fields"], "dialogue": "speech"}}
    client.put(f"/api/v1/accounts/{account_id}", json={"name": acc["name"], "persona": acc["persona"],
                                                        "style_guide": None, "params": params, "is_active": True})
    pid = _create(client, account_id)
    await _to_queued(client, pid, make_worker(), make_pipeline(), dialogue_edit={"tts_text": "单独传的台词"})
    assert _task(pid).dialogue == "单独传的台词"


def test_dialogue_without_any_route_is_rejected_up_front(client, account_id):
    """既没有台词字段、也没有「台词写法」模板：台词会被悄悄丢掉，所以创建时就拒绝。"""
    line = _template(client, account_id, "video_dialogue")
    client.delete(f"/api/v1/templates/{line['id']}")
    r = client.post(P, json={"account_id": account_id, "topic": "t", "run_mode": "now"})
    assert r.status_code == 422 and "台词" in r.json()["message"]


def test_reference_image_is_required_by_the_h3_workflow(client, account_id, image_id):
    acc = client.get(f"/api/v1/accounts/{account_id}").json()["data"]
    client.put(f"/api/v1/accounts/{account_id}", json={
        "name": acc["name"], "persona": acc["persona"], "style_guide": None,
        "params": {**acc["params"], "requires_image": True}, "is_active": True})
    body = {"account_id": account_id, "topic": "t", "run_mode": "now"}
    r = client.post(P, json=body)
    assert r.status_code == 422 and "参考图片" in r.json()["message"]
    assert client.post(P, json={**body, "reference_file_ids": [image_id]}).status_code == 202


async def test_seed_defaults_from_database_and_can_be_overridden(client, account_id, make_worker, make_pipeline):
    a = _create(client, account_id)
    b = _create(client, account_id, seed=7)
    assert _detail(client, a)["seed"] == 683072603085674 and _detail(client, b)["seed"] == 7
    vw, pw = make_worker(), make_pipeline()
    for pid in (a, b):
        await _to_queued(client, pid, vw, pw)
    assert {_task(a).seed, _task(b).seed} == {683072603085674, 7}


async def test_auto_topic_filled_from_llm_and_user_topic_sent(client, account_id, make_worker, make_pipeline, llm):
    pid = _create(client, account_id, topic="")
    await drain_both(make_worker(), make_pipeline())
    assert _detail(client, pid)["topic"] == "占位主题"  # 留空时回填大模型选的主题
    assert "【本次主题】\n（主题为空" in llm.calls[-1][1]

    pid2 = _create(client, account_id, topic="拒绝讨好")
    await drain_both(make_worker(), make_pipeline())
    assert "【本次主题】拒绝讨好" in llm.calls[-1][1]
    assert _detail(client, pid2)["topic"] == "拒绝讨好"


async def test_shorter_duration_is_passed_to_llm(client, account_id, make_worker, make_pipeline, llm):
    _create(client, account_id, duration_seconds=10)
    await drain_both(make_worker(), make_pipeline())
    assert "【视频时长】10 秒" in llm.calls[-1][1]


def _template(client, account_id, kind):
    return client.get(f"/api/v1/templates?kind={kind}&account_id={account_id}").json()["data"][0]


async def test_editing_a_template_in_the_database_changes_the_final_prompt(client, account_id, make_worker, make_pipeline):
    """核心：固定的提示词在库里，改了就生效，不需要改代码。"""
    shot, base = _template(client, account_id, "video_shot"), _template(client, account_id, "video_base")
    client.put(f"/api/v1/templates/{shot['id']}", json={
        "name": shot["name"], "account_id": account_id, "body": "[{{shot_index}}/{{start}}-{{end}}] {{scene_desc}}"})
    client.put(f"/api/v1/templates/{base['id']}", json={
        "name": base["name"], "account_id": account_id, "body": "PREFIX {{aspect_ratio}} | "})
    pid = _create(client, account_id, resolution="768p横")
    await _to_queued(client, pid, make_worker(), make_pipeline())
    prompt = _task(pid).prompt
    assert prompt.startswith("PREFIX 16:9 | A cute chibi girl")  # 前缀来自库，角色设定仍来自库里的另一份模板
    assert "[1/0-5] scene 1 [2/5-10] scene 2 [3/10-15] scene 3" in prompt  # 镜头写法来自库


async def test_business_line_level_template_applies_when_account_has_none(client, account_id, make_worker, make_pipeline):
    """业务线通用模板：账号类型自己没有某份模板时，用所在业务线的。"""
    mine = _template(client, account_id, "video_negative")
    client.delete(f"/api/v1/templates/{mine['id']}")  # 停用账号类型专属的负向提示词
    client.post("/api/v1/templates", json={
        "kind": "video_negative", "name": "视频号通用负向", "body": "BL-NEGATIVE", "platform": "wechat_channels"})
    pid = _create(client, account_id)
    await _to_queued(client, pid, make_worker(), make_pipeline())
    assert _task(pid).prompt.endswith("Negative prompt (avoid all of these): BL-NEGATIVE")


def test_missing_template_is_reported_instead_of_silently_using_code_defaults(client, account_id):
    shot = _template(client, account_id, "video_shot")
    client.delete(f"/api/v1/templates/{shot['id']}")
    r = client.post(P, json={"account_id": account_id, "topic": "t", "run_mode": "now"})
    assert r.status_code == 422 and "镜头写法" in r.json()["message"]


async def test_missing_content_template_fails_the_production_with_a_clear_reason(client, account_id, make_worker, make_pipeline):
    pid = _create(client, account_id)
    content = _template(client, account_id, "content")
    client.delete(f"/api/v1/templates/{content['id']}")  # 创建之后才被停用
    await drain_both(make_worker(), make_pipeline())
    d = _detail(client, pid)
    assert d["status"] == "failed" and "内容生成（系统提示）" in d["error_message"]


async def test_regenerate_with_feedback_keeps_history(client, account_id, make_worker, make_pipeline, llm):
    vw, pw = make_worker(), make_pipeline()
    pid = _create(client, account_id)
    await drain_both(vw, pw)
    client.post(f"{P}/{pid}/scene/approve", json={})
    # 在审核 B 发现整体不对：带意见整体重来，回到审核 A
    r = client.post(f"{P}/{pid}/regenerate", json={"feedback": "镜头再慢一点"})
    assert r.json()["data"]["status"] == "scene_generating"
    await drain_both(vw, pw)
    d = _detail(client, pid)
    assert d["status"] == "scene_review" and d["content"]["version"] == 2
    assert d["content"]["feedback"] == "镜头再慢一点" and len(d["history"]) == 2
    assert "镜头再慢一点" in llm.calls[-1][1] and "【上一版】" in llm.calls[-1][1]


async def test_discard_during_llm_generation_drops_result(client, account_id, make_pipeline, llm):
    """人工在 LLM 生成过程中点了废弃：生成结果不能把状态改回去。"""
    pid = _create(client, account_id)
    original = llm.chat_json

    async def discard_then_answer(system, user):
        assert client.post(f"{P}/{pid}/discard", json={"reason": "换主题"}).status_code == 200
        return await original(system, user)

    llm.chat_json = discard_then_answer
    await make_pipeline().run_once()
    d = _detail(client, pid)
    assert d["status"] == "discarded" and d["content"] is None


async def test_night_mode_waits_for_window_and_shows_queue_order(client, account_id, make_worker, make_pipeline):
    pw = make_pipeline()
    ids = [_create(client, account_id, run_mode="night", topic=f"主题{i}") for i in range(2)]
    for pid in ids:
        await drain_both(make_worker(), pw)
        client.post(f"{P}/{pid}/scene/approve", json={})
        client.post(f"{P}/{pid}/dialogue/approve", json={})

    # 窗口关闭（起止相同 = 空窗口）：任务一直排队，不会提交到 GPU
    await drain_both(make_worker(**{"generation_window_start": "00:00", "generation_window_end": "00:00"}), pw)
    details = [_detail(client, pid) for pid in ids]
    assert [d["status"] for d in details] == ["queued", "queued"]
    assert [d["video"]["queue_position"] for d in details] == [1, 2]  # 排队顺序先到先得
    assert all(d["video"]["status"] == "pending" for d in details)

    # 窗口打开后才会执行，排队信息消失
    await drain_both(make_worker(generation_window_enabled=False), pw)
    done = [_detail(client, pid) for pid in ids]
    assert {d["status"] for d in done} == {"video_review"} and done[0]["video"]["queue_position"] is None


async def test_llm_failure_then_retry(client, account_id, make_worker, make_pipeline, llm):
    pid = _create(client, account_id)
    llm.fail_next = LLMError("LLM_AUTH_FAILED", "key 无效")
    await drain_both(make_worker(), make_pipeline())
    d = _detail(client, pid)
    assert d["status"] == "failed" and d["failed_stage"] == "content" and "LLM_AUTH_FAILED" in d["error_message"]
    assert client.post(f"{P}/{pid}/retry").status_code == 202
    await drain_both(make_worker(), make_pipeline())
    assert _detail(client, pid)["status"] == "scene_review"


async def test_video_failure_then_retry_and_regenerate(client, account_id, make_worker, make_pipeline, provider):
    vw, pw = make_worker(), make_pipeline()
    pid = _create(client, account_id)
    await _to_queued(client, pid, vw, pw)
    provider.fail_with = "GPU 出错"
    await drain_both(vw, pw)
    d = _detail(client, pid)
    assert d["status"] == "failed" and d["failed_stage"] == "video"

    provider.fail_with = None
    assert client.post(f"{P}/{pid}/retry").status_code == 202
    await drain_both(vw, pw)
    assert _detail(client, pid)["status"] == "video_review"

    # 成片不满意：改分镜后重新生成，会创建新的视频任务
    first_task = _detail(client, pid)["video"]["task_id"]
    scenes = [{"scene_id": 1, "scene_desc": "new scene", "action_desc": "a", "camera_desc": "c"}]
    assert client.post(f"{P}/{pid}/video/regenerate", json={"scenes": scenes}).status_code == 202
    assert _detail(client, pid)["video"]["task_id"] != first_task
    assert _task(pid).seed != 683072603085674  # 重新生成换了新的随机 seed，否则内容相同会得到相同视频
    await drain_both(vw, pw)
    assert _detail(client, pid)["status"] == "video_review"
    assert "Shot 1 (0-15s): new scene a c" in _task(pid).prompt


async def test_back_to_scene_from_dialogue_review(client, account_id, make_worker, make_pipeline):
    vw, pw = make_worker(), make_pipeline()
    pid = _create(client, account_id)
    await drain_both(vw, pw)
    client.post(f"{P}/{pid}/scene/approve", json={})
    assert client.post(f"{P}/{pid}/dialogue/back").json()["data"]["status"] == "scene_review"


def test_create_validation(client, account_id):
    base = {"account_id": account_id, "topic": "t"}
    assert client.post(P, json={**base, "duration_seconds": 16}).status_code == 422  # 最长 15 秒
    assert client.post(P, json={**base, "resolution": "4k"}).status_code == 422
    assert client.post(P, json={**base, "reference_file_ids": ["x"] * 9}).status_code == 422  # 最多 8 张
    assert client.post(P, json={**base, "reference_file_ids": ["missing"]}).status_code == 422
    assert client.post(P, json={**base, "account_id": "nope"}).status_code == 422


async def test_reference_images_are_attached_to_the_task(client, account_id, image_id, make_worker, make_pipeline):
    pid = _create(client, account_id, reference_file_ids=[image_id])
    assert len(_detail(client, pid)["reference_images"]) == 1
    await _to_queued(client, pid, make_worker(), make_pipeline())
    assert _task(pid).input_file_ids == [image_id]


async def test_review_queue_filter(client, account_id, make_worker, make_pipeline):
    pid = _create(client, account_id)
    other = _create(client, account_id, topic="另一个")
    await drain(make_pipeline())
    client.post(f"{P}/{other}/discard", json={})
    ids = [i["id"] for i in client.get(f"{P}?needs_review=true").json()["data"]["items"]]
    assert ids == [pid]


async def test_discard_running_video_stops_tracking(client, account_id, make_worker, make_pipeline):
    vw, pw = make_worker(), make_pipeline()
    pid = _create(client, account_id)
    await _to_queued(client, pid, vw, pw)
    await vw.run_once()  # 已提交
    assert client.post(f"{P}/{pid}/discard", json={}).status_code == 200
    d = _detail(client, pid)
    assert d["status"] == "discarded" and d["video"]["status"] == "cancelled"
    await drain(vw)
    assert _detail(client, pid)["status"] == "discarded"
