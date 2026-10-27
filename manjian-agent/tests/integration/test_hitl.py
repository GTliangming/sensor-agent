"""HITL（人工介入）集成测试：暂停 / 通过 / 编辑 / 回炉 / 取消 / 全程出片。

默认 fake provider + 临时 SQLite（见 conftest），渲染用真实 ffmpeg。
直接调用 TaskService 的 async 方法：run_task 跑到首个闸门暂停，resume_task 推进一段。
"""
from __future__ import annotations

import uuid

import pytest

from app.domain.request import CreateTaskRequest
from app.graph.state import TaskStatus
from app.services.task_service import ReviewError, TaskService, get_task_service

ALL_GATES = ["storyboard", "assets", "images", "tts", "clips", "subtitles"]


def _create(svc, **overrides) -> str:
    req = CreateTaskRequest(
        request_id=f"hitl_{uuid.uuid4().hex[:12]}",
        topic="雨后的街道", target_seconds=12, hitl=True, **overrides,
    )
    task, created = svc.create_task(req)
    assert created
    return task["task_id"]


async def _approve_to_end(svc, task_id: str) -> tuple[dict, list[str]]:
    gates: list[str] = []
    task = svc.get_task(task_id)
    while task["status"] == TaskStatus.AWAITING_REVIEW:
        gates.append(task["stage"])
        task = await svc.resume_task(task_id, "approve")
    return task, gates


@pytest.mark.asyncio
async def test_hitl_pauses_at_storyboard_first():
    svc = get_task_service()
    task_id = _create(svc)
    task = await svc.run_task(task_id)
    assert task["status"] == TaskStatus.AWAITING_REVIEW
    assert task["stage"] == "storyboard"
    review = task["result"]["review"]
    assert review["gate"] == "storyboard"
    assert review["artifact"]["scenes"], "分镜待审产物应包含场景"
    assert set(review["actions"]) == {"approve", "edit", "regenerate", "cancel"}


@pytest.mark.asyncio
async def test_hitl_walk_all_gates_to_succeeded():
    svc = get_task_service()
    task_id = _create(svc)
    await svc.run_task(task_id)
    task, gates = await _approve_to_end(svc, task_id)
    assert gates == ALL_GATES, f"应依次经过全部闸门，实际 {gates}"
    assert task["status"] == TaskStatus.SUCCEEDED
    rp = task["result"]["render_plan"]
    assert rp["validated"] is True
    assert rp["output_path"].endswith("output.mp4")


@pytest.mark.asyncio
async def test_hitl_edit_storyboard_takes_effect():
    svc = get_task_service()
    task_id = _create(svc)
    task = await svc.run_task(task_id)
    edited = dict(task["result"]["review"]["artifact"])
    edited["title"] = "人工改过的标题"
    task = await svc.resume_task(task_id, "edit", edit=edited)
    # 编辑后应推进到下一个闸门（素材），且分镜标题已被替换
    assert task["stage"] == "assets"
    assert task["result"]["storyboard"]["title"] == "人工改过的标题"


@pytest.mark.asyncio
async def test_hitl_regenerate_reenters_storyboard_gate():
    svc = get_task_service()
    task_id = _create(svc)
    await svc.run_task(task_id)
    task = await svc.resume_task(task_id, "regenerate", feedback="节奏再快一点")
    # 打回重做后应再次停在分镜闸门
    assert task["status"] == TaskStatus.AWAITING_REVIEW
    assert task["stage"] == "storyboard"


@pytest.mark.asyncio
async def test_hitl_cancel_at_gate():
    svc = get_task_service()
    task_id = _create(svc)
    await svc.run_task(task_id)
    task = await svc.resume_task(task_id, "cancel")
    assert task["status"] == TaskStatus.CANCELLED


@pytest.mark.asyncio
async def test_hitl_disabled_runs_without_pausing():
    svc = get_task_service()
    req = CreateTaskRequest(request_id=f"plain_{uuid.uuid4().hex[:12]}", topic="城市夜景", target_seconds=12)
    task, _ = svc.create_task(req)
    final = await svc.run_task(task["task_id"])
    assert final["status"] == TaskStatus.SUCCEEDED


@pytest.mark.asyncio
async def test_hitl_invalid_edit_rejected_without_side_effects():
    svc = get_task_service()
    task_id = _create(svc)
    await svc.run_task(task_id)
    for bad in (None, {"title": "缺字段"}, {"title": "t", "hook": "h", "closing_line": "c", "scenes": []}):
        with pytest.raises(ReviewError):
            svc.validate_review(task_id, "edit", bad)
        with pytest.raises(ReviewError):
            await svc.resume_task(task_id, "edit", edit=bad)
    # 非法编辑不应改变任务状态，仍停在分镜闸门
    task = svc.get_task(task_id)
    assert task["status"] == TaskStatus.AWAITING_REVIEW and task["stage"] == "storyboard"


@pytest.mark.asyncio
async def test_hitl_pause_survives_service_restart():
    """checkpoint 落 SQLite：换一个全新的 TaskService 实例（模拟进程重启）仍能 resume。"""
    svc = get_task_service()
    task_id = _create(svc)
    await svc.run_task(task_id)

    fresh = TaskService(svc._settings, svc._repo)
    assert await fresh.reconcile_review_tasks() == []
    task = await fresh.resume_task(task_id, "approve")
    assert task["status"] == TaskStatus.AWAITING_REVIEW and task["stage"] == "assets"
    await fresh.aclose()


@pytest.mark.asyncio
async def test_hitl_lost_checkpoint_fails_instead_of_hanging():
    svc = get_task_service()
    task_id = _create(svc)
    # 伪造"待审但无 checkpoint"的孤儿任务
    svc._repo.update_task(task_id, status=TaskStatus.AWAITING_REVIEW, stage="storyboard", result={})
    assert task_id in await svc.reconcile_review_tasks()
    task = svc.get_task(task_id)
    assert task["status"] == TaskStatus.FAILED and task["error_code"] == "checkpoint_lost"


@pytest.mark.asyncio
async def test_cancel_interrupts_running_node():
    """取消监视器应能打断正在执行的长节点，而不是等到节点边界。"""
    import asyncio

    svc = get_task_service()
    task_id = _create(svc)

    async def slow():
        await asyncio.sleep(30)

    async def cancel_soon():
        await asyncio.sleep(0.3)
        svc._repo.update_task(task_id, status=TaskStatus.CANCEL_REQUESTED)

    asyncio.ensure_future(cancel_soon())
    result, terminal = await asyncio.wait_for(svc._guarded(task_id, slow), 10)
    assert result is None and terminal["status"] == TaskStatus.CANCELLED
