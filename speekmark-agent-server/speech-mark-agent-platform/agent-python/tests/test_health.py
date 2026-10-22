"""接口冒烟测试：用 FastAPI TestClient 验证健康检查与一次完整运行。"""

from fastapi.testclient import TestClient
from app.main import app

# TestClient 在进程内直接驱动 FastAPI 应用，无需真正启动 HTTP 服务器即可发请求。
client = TestClient(app)


def test_liveness():
    # 存活探针：确认服务已就绪，返回 200 且状态为 alive。
    response = client.get("/health/live")
    assert response.status_code == 200
    assert response.json()["status"] == "alive"


def test_create_run_and_trace():
    # 端到端验证演示工作流：创建一次运行，应成功且回答命中示例知识库。
    created = client.post("/v1/runs", json={"run_id": "run_test_123", "input": "解释切分边界标准", "mode": "balanced"})
    assert created.status_code == 200
    body = created.json()
    assert body["status"] == "succeeded"
    assert "示例知识库" in body["final_answer"]
    # 再按 run_id 拉取轨迹，确认事件已落地且数量符合预期。
    trace = client.get("/v1/runs/run_test_123/trace")
    assert trace.status_code == 200
    assert len(trace.json()["events"]) >= 3
