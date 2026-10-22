from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field

RunMode = Literal["fast", "balanced", "careful"]
RunStatus = Literal["queued", "running", "succeeded", "failed", "cancelled", "waiting_approval"]


class CreateRunRequest(BaseModel):
    run_id: str | None = Field(default=None, min_length=3, max_length=64)
    input: str = Field(min_length=1, max_length=12_000)
    mode: RunMode = "balanced"


class TraceEvent(BaseModel):
    event_id: str
    run_id: str
    seq: int
    type: str
    node: str
    title: str
    detail: str
    status: str = "succeeded"
    duration_ms: int = 0
    tool_call_id: str | None = None
    input_summary: str | None = None
    output_summary: str | None = None
    created_at: datetime


class RunResponse(BaseModel):
    run_id: str
    input: str
    status: RunStatus
    final_answer: str | None = None
    error: str | None = None
    started_at: datetime
    finished_at: datetime | None = None
    duration_ms: int = 0
    steps: int = 0
    tools: int = 0
    tokens: int = 0
