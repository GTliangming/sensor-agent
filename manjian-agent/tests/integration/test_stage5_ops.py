
from app.config import get_settings
from app.domain.request import CreateTaskRequest
from app.graph.state import TaskStatus
from app.repositories.sqlite import TaskRepository
from app.services.task_service import TaskService


def _svc(tmp_path):
    settings = get_settings().model_copy(update={"data_dir": str(tmp_path), "app_env": "test"})
    repo = TaskRepository(tmp_path / "ops.db")
    return TaskService(settings, repo), repo


def test_request_cancel_transitions(tmp_path):
    svc, _ = _svc(tmp_path)
    task, _ = svc.create_task(CreateTaskRequest(request_id="c1", topic="x"))
    assert svc.request_cancel(task["task_id"]) is True
    assert svc.get_task(task["task_id"])["status"] == TaskStatus.CANCEL_REQUESTED
    assert svc.request_cancel("missing") is False


def test_recover_orphans_requeues_running(tmp_path):
    svc, repo = _svc(tmp_path)
    task, _ = svc.create_task(CreateTaskRequest(request_id="o1", topic="x"))
    repo.update_task(task["task_id"], status=TaskStatus.RUNNING)
    recovered = svc.recover_orphans()
    assert task["task_id"] in recovered
    assert svc.get_task(task["task_id"])["status"] == TaskStatus.QUEUED


def test_metrics_and_cleanup(tmp_path):
    svc, repo = _svc(tmp_path)
    t1, _ = svc.create_task(CreateTaskRequest(request_id="m1", topic="x"))
    repo.update_task(t1["task_id"], status=TaskStatus.SUCCEEDED)
    t2, _ = svc.create_task(CreateTaskRequest(request_id="m2", topic="y"))
    repo.update_task(t2["task_id"], status=TaskStatus.FAILED)
    m = svc.metrics()
    assert m["total"] == 2
    assert m["success_rate"] == 0.5
    # cleanup 未来 cutoff（days=-1）清掉全部
    assert svc.cleanup_old_tasks(days=-1) == 2
    assert svc.metrics()["total"] == 0
