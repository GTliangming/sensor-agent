"""Agent 运行相关的 HTTP 路由定义。

使用 FastAPI 的 APIRouter 将接口按模块聚合，再由 main.py 统一挂载到应用上。
这里的接口负责：创建运行任务、查询运行结果、查询运行过程中的 trace 事件。
"""

from fastapi import APIRouter, HTTPException
from app.schemas.run import CreateRunRequest, RunResponse
from app.services import run_service

# APIRouter 相当于一组路由的集合；prefix 使下面所有路径都带上 /v1 前缀，tags 用于 OpenAPI 文档分组。
router = APIRouter(prefix="/v1", tags=["Agent 运行"])


@router.post("/runs", response_model=RunResponse)
def create_run(req: CreateRunRequest) -> RunResponse:
    """创建并执行一次 Agent 运行。

    请求体由 FastAPI 依据类型注解自动解析并用 CreateRunRequest 校验；
    response_model=RunResponse 声明响应结构，FastAPI 会据此做序列化与字段过滤。
    """
    return run_service.create_run(req)


@router.get("/runs/{run_id}", response_model=RunResponse)
def get_run(run_id: str) -> RunResponse:
    """按 run_id 查询单次运行的结果。"""
    run = run_service.get_run(run_id)
    if run is None:
        # 查不到对应任务时抛出 HTTPException，FastAPI 会将其转换为 404 响应，detail 作为结构化错误体返回。
        raise HTTPException(status_code=404, detail={"code": "RUN_NOT_FOUND", "message": "运行任务不存在"})
    return run


@router.get("/runs/{run_id}/trace")
def get_trace(run_id: str) -> dict:
    """查询某次运行的执行轨迹（trace 事件列表），用于前端可视化 Agent 的每一步。"""
    events = run_service.get_trace(run_id)
    if events is None:
        raise HTTPException(status_code=404, detail={"code": "RUN_NOT_FOUND", "message": "运行任务不存在"})
    # 将 Pydantic 事件模型逐个转为可 JSON 序列化的字典后返回。
    return {"run_id": run_id, "events": [event.model_dump(mode="json") for event in events]}
