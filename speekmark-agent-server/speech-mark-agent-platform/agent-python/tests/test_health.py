from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_liveness():
    response = client.get("/health/live")
    assert response.status_code == 200
    assert response.json()["status"] == "alive"


def test_create_run_and_trace():
    created = client.post("/v1/runs", json={"run_id": "run_test_123", "input": "解释切分边界标准", "mode": "balanced"})
    assert created.status_code == 200
    body = created.json()
    assert body["status"] == "succeeded"
    assert "示例知识库" in body["final_answer"]
    trace = client.get("/v1/runs/run_test_123/trace")
    assert trace.status_code == 200
    assert len(trace.json()["events"]) >= 3
