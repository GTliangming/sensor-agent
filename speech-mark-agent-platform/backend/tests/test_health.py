import pytest
from fastapi.testclient import TestClient
from app.core.config import get_settings
from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_health_ok(client: TestClient) -> None:
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["data"]["status"] == "ok"
    assert body["data"]["appEnv"] == get_settings().app_env      # 验证 camelCase
    assert body["meta"]["requestId"].startswith("req_")
    assert resp.headers["X-Request-Id"] == body["meta"]["requestId"]


def test_request_id_passthrough(client: TestClient) -> None:
    resp = client.get("/api/health", headers={"X-Request-Id": "req_manual_001"})
    assert resp.headers["X-Request-Id"] == "req_manual_001"
    assert resp.json()["meta"]["requestId"] == "req_manual_001"


def test_not_found_envelope(client: TestClient) -> None:
    resp = client.get("/api/not-exist")
    assert resp.status_code == 404
    body = resp.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "NOT_FOUND"
    assert body["error"]["retryable"] is False


def test_method_not_allowed_envelope(client: TestClient) -> None:
    resp = client.post("/api/health")
    assert resp.status_code == 405
    assert resp.json()["error"]["code"] == "METHOD_NOT_ALLOWED"