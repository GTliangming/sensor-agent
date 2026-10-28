"""Worker 全流程：提交、轮询、转存、失败、取消、重试、崩溃恢复、并发领取。"""
from sqlalchemy import update

from app.core.exceptions import ProviderError
from app.core.time import utcnow
from app.db.session import SessionLocal
from app.models import VideoTask
from app.repositories.video_task_repository import VideoTaskRepository
from tests.conftest import drain


def _detail(client, tid):
    return client.get(f"/api/v1/videos/{tid}").json()["data"]


async def test_full_success_flow(client, create_task, make_worker):
    tid = create_task().json()["data"]["task_id"]
    await drain(make_worker())

    d = _detail(client, tid)
    assert d["status"] == "succeeded", d
    assert d["video_url"].endswith(f"/api/v1/files/videos/{tid}.mp4")
    # 结果可通过文件接口取回，且是 MP4
    r = client.get(f"/api/v1/files/videos/{tid}.mp4")
    assert r.status_code == 200 and r.content[4:8] == b"ftyp"
    assert client.get(f"/api/v1/videos/{tid}/result").json()["data"]["content_type"] == "video/mp4"
    types = [e["event_type"] for e in d["events"]]
    assert types[0] == "task_created" and "provider_submitted" in types and types[-1] == "result_saved"


async def test_provider_failure_is_recorded_and_retry_works(client, create_task, make_worker, provider):
    tid = create_task().json()["data"]["task_id"]
    provider.fail_with = "模型内部错误"
    await drain(make_worker())
    d = _detail(client, tid)
    assert d["status"] == "failed" and d["error_code"] == "PROVIDER_TASK_FAILED" and d["can_retry"]

    provider.fail_with = None
    assert client.post(f"/api/v1/videos/{tid}/retry").status_code == 202
    await drain(make_worker())
    d = _detail(client, tid)
    assert d["status"] == "succeeded" and d["retry_count"] == 1


async def test_cancel_not_overwritten_by_worker(client, create_task, make_worker):
    tid = create_task().json()["data"]["task_id"]
    worker = make_worker()
    await worker.run_once()  # pending -> submitted
    assert client.post(f"/api/v1/videos/{tid}/cancel").json()["data"]["external_cancelled"] is False
    await drain(worker)
    assert _detail(client, tid)["status"] == "cancelled"
    assert client.post(f"/api/v1/videos/{tid}/cancel").status_code == 409


async def test_submit_uncertain_requires_confirmation(client, create_task, make_worker, provider):
    tid = create_task().json()["data"]["task_id"]
    provider.fail_next_submit = ProviderError("SUBMIT_UNCERTAIN", "读超时", retryable=True, submit_uncertain=True)
    await drain(make_worker())
    d = _detail(client, tid)
    assert d["status"] == "failed" and d["error_code"] == "SUBMIT_UNCERTAIN"
    assert client.post(f"/api/v1/videos/{tid}/retry").status_code == 409
    assert client.post(f"/api/v1/videos/{tid}/retry?confirm_duplicate=true").status_code == 202


async def test_connect_error_is_retried_automatically(client, create_task, make_worker, provider):
    tid = create_task().json()["data"]["task_id"]
    provider.fail_next_submit = ProviderError("PROVIDER_UNREACHABLE", "连不上", retryable=True)
    await drain(make_worker(submit_max_retries=2))
    # 第一次失败后退避 5 秒，这里把 next_poll_at 拨回现在以继续
    with SessionLocal() as db:
        db.execute(update(VideoTask).values(next_poll_at=None))
        db.commit()
    await drain(make_worker())
    assert _detail(client, tid)["status"] == "succeeded"


async def test_crash_after_submit_start_does_not_resubmit(client, create_task, make_worker):
    """模拟：attempt 已落库但进程在拿到 provider_task_id 前崩溃。"""
    tid = create_task().json()["data"]["task_id"]
    with SessionLocal() as db:
        repo = VideoTaskRepository(db)
        repo.create_attempt(tid, "token-x")  # status=started
        db.commit()
    await drain(make_worker())
    d = _detail(client, tid)
    assert d["status"] == "failed" and d["error_code"] == "SUBMIT_UNCERTAIN"


def test_claim_is_exclusive_and_lease_expiry_allows_takeover(create_task):
    create_task()
    with SessionLocal() as a, SessionLocal() as b:
        assert VideoTaskRepository(a).claim_next("w1", 60) is not None
        assert VideoTaskRepository(b).claim_next("w2", 60) is None  # 租约未过期
    with SessionLocal() as db:
        db.execute(update(VideoTask).values(lease_expires_at=utcnow().replace(year=2000)))
        db.commit()
        assert VideoTaskRepository(db).claim_next("w2", 60).claimed_by == "w2"
