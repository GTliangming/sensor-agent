from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

# --- Start Graph Run ---
class StartRequest(BaseModel):
    human_request: str

# --- Resume Paused Graph Run ---
class ResumeRequest(BaseModel):
    thread_id: str
    review_action: Literal["approved", "feedback"]
    human_comment: Optional[str] = None

    @model_validator(mode="after")
    def feedback_requires_comment(self):
        if self.review_action == "feedback" and not (self.human_comment or "").strip():
            raise ValueError("feedback 操作需要填写 human_comment")
        return self


class PlanStepInput(BaseModel):
    description: str = Field(min_length=1, max_length=500)

    @field_validator("description")
    @classmethod
    def trim_description(cls, description):
        description = description.strip()
        if not description:
            raise ValueError("计划步骤不能为空")
        return description


class PlanStepOutput(BaseModel):
    id: str
    description: str
    status: Literal["pending", "running", "completed", "failed"]
    result: Optional[str] = None
    error: Optional[str] = None


class PlanReviewRequest(BaseModel):
    thread_id: str
    plan_action: Literal["approved", "replan"]
    plan_steps: list[PlanStepInput] = Field(default_factory=list, max_length=7)
    plan_feedback: Optional[str] = Field(default=None, max_length=2000)

    @field_validator("plan_steps")
    @classmethod
    def approved_plan_must_have_steps(cls, steps, info):
        if info.data.get("plan_action") == "approved" and not steps:
            raise ValueError("至少需要一个计划步骤")
        return steps

    @model_validator(mode="after")
    def replanning_requires_feedback(self):
        if self.plan_action == "replan" and not (self.plan_feedback or "").strip():
            raise ValueError("replan 操作需要填写 plan_feedback")
        return self

# --- Minimal API Response ---
class GraphResponse(BaseModel):
    thread_id: str
    run_status: Literal["finished", "plan_review", "user_feedback", "pending"]
    assistant_response: Optional[str] = None
    plan_steps: list[PlanStepOutput] = Field(default_factory=list)

class ApproveRequest(BaseModel):
    thread_id: str
    approve_action: Literal["approved", "rejected"]
