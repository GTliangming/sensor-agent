from fastapi import APIRouter, HTTPException
from app.schemas.run import CreateRunRequest, RunResponse
from app.services import run_service

router = APIRouter(prefix="/v1", tags=["Agent 运行"])


@router.post("/runs", response_model=RunResponse)
def create_run(req: CreateRunRequest) -> RunResponse:
    return run_service.create_run(req)


@router.get("/runs/{run_id}", response_model=RunResponse)
def get_run(run_id: str) -> RunResponse:
    run = run_service.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail={"code": "RUN_NOT_FOUND", "message": "运行任务不存在"})
    return run


@router.get("/runs/{run_id}/trace")
def get_trace(run_id: str) -> dict:
    events = run_service.get_trace(run_id)
    if events is None:
        raise HTTPException(status_code=404, detail={"code": "RUN_NOT_FOUND", "message": "运行任务不存在"})
    return {"run_id": run_id, "events": [event.model_dump(mode="json") for event in events]}
