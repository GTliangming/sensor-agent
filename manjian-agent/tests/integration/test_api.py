import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture()
def client():
    with TestClient(create_app()) as c:
        yield c


def test_health(client):
    assert client.get("/healthz").json() == {"status": "ok"}
    r = client.get("/readyz")
    assert r.status_code == 200
    assert r.json()["text_provider"] == "fake"


def test_create_and_get_task(client):
    body = {"request_id": "api_req_1", "topic": "海边日落", "target_seconds": 12}
    r = client.post("/internal/v1/tasks", json=body)
    assert r.status_code == 202
    data = r.json()
    assert data["created"] is True
    task_id = data["task_id"]

    g = client.get(f"/internal/v1/tasks/{task_id}")
    assert g.status_code == 200
    tv = g.json()
    assert tv["status"] == "succeeded"
    assert tv["result"]["storyboard"]["scenes"]
    assert tv["result"]["render_plan"]["output_path"].endswith("output.mp4")
    assert tv["result"]["render_plan"]["validated"] is True


def test_idempotent_request_id(client):
    body = {"request_id": "api_req_dup", "topic": "森林清晨"}
    first = client.post("/internal/v1/tasks", json=body).json()
    second = client.post("/internal/v1/tasks", json=body).json()
    assert first["task_id"] == second["task_id"]
    assert second["created"] is False


def test_get_missing_task_404(client):
    assert client.get("/internal/v1/tasks/nope").status_code == 404


def test_invalid_body_422(client):
    r = client.post("/internal/v1/tasks", json={"request_id": "x"})
    assert r.status_code == 422
