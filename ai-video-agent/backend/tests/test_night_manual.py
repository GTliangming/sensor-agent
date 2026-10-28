"""手动创建任务的夜间模式：白天夜间都能创建，后台等到窗口才提交，并发不超过上限，结果异步轮询。"""
from app.core.config import Settings
from tests.conftest import drain

CLOSED = dict(generation_window_start="00:00", generation_window_end="00:00")  # 起止相同 = 窗口永远关闭


def _detail(client, tid):
    return client.get(f"/api/v1/videos/{tid}").json()["data"]


def test_default_limits():
    assert Settings().generation_max_inflight == 3


def test_night_is_default_and_creation_is_never_blocked_by_window(client, account_id):
    body = {"account_id": account_id, "prompt": "p"}
    ids = [client.post("/api/v1/videos", json=body).json()["data"]["task_id"] for _ in range(6)]
    assert len(set(ids)) == 6  # 创建不受并发上限（3）影响，超出的只是排队
    assert _detail(client, ids[0])["schedule_mode"] == "window"


async def test_night_task_waits_while_window_closed_then_runs(client, create_task, make_worker):
    tid = create_task(run_mode="night").json()["data"]["task_id"]
    await drain(make_worker(**CLOSED))
    d = _detail(client, tid)
    assert d["status"] == "pending" and d["expected_start_at"] is not None  # 窗口外：只排队，不提交

    await drain(make_worker(generation_window_enabled=False))  # 窗口开启：提交并异步轮询到完成
    assert _detail(client, tid)["status"] == "succeeded"


async def test_now_mode_runs_even_when_window_closed(client, create_task, make_worker):
    tid = create_task(run_mode="now").json()["data"]["task_id"]
    await drain(make_worker(**CLOSED))
    assert _detail(client, tid)["status"] == "succeeded"


async def test_at_most_three_run_concurrently(client, create_task, make_worker):
    ids = [create_task().json()["data"]["task_id"] for _ in range(5)]
    worker = make_worker()  # 默认并发上限 3
    # 轮询间隔拉长，避免最早的任务一直“到期”而占住 Worker，让后面的任务也有机会被提交
    worker.s.autodl_poll_interval_seconds = worker.s.autodl_poll_max_interval_seconds = 60
    for _ in range(8):
        await worker.run_once()
    statuses = [_detail(client, t)["status"] for t in ids]
    assert statuses.count("submitted") == 3 and statuses.count("pending") == 2  # 第 4、5 个只排队

    # 前面的任务完成后，排队的会自动补上
    worker.s.autodl_poll_interval_seconds = worker.s.autodl_poll_max_interval_seconds = 0
    from sqlalchemy import update

    from app.db.session import SessionLocal
    from app.models import VideoTask
    with SessionLocal() as db:
        db.execute(update(VideoTask).values(next_poll_at=None))
        db.commit()
    await drain(worker, max_steps=80)
    assert {_detail(client, t)["status"] for t in ids} == {"succeeded"}
