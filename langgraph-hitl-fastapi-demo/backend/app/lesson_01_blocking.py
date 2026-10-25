# Lesson 1: Basic Blocking API
# Traditional RESTful API with blocking request/response pattern

from fastapi import APIRouter, HTTPException
from uuid import uuid4
from app.models import GraphResponse, PlanReviewRequest, ResumeRequest, StartRequest
from app.graph import graph

router = APIRouter()


def run_graph_and_response(input_state, config):
    graph.invoke(input_state, config)
    state = graph.get_state(config)
    state_values = state.values or {}
    next_nodes = state.next or []
    thread_id = config["configurable"]["thread_id"]
    if "human_plan_review" in next_nodes:
        run_status = "plan_review"
    elif "human_feedback" in next_nodes:
        run_status = "user_feedback"
    else:
        run_status = "finished"
    return GraphResponse(
        thread_id=thread_id,
        run_status=run_status,
        assistant_response=state_values.get("assistant_response"),
        plan_steps=state_values.get("plan_steps", [])
    )

@router.post("/graph/start", response_model=GraphResponse)
def start_graph(request: StartRequest):
    thread_id = str(uuid4())
    config = {"configurable": {"thread_id": thread_id}}
    initial_state = {"human_request": request.human_request}

    return run_graph_and_response(initial_state, config)

@router.post("/graph/resume", response_model=GraphResponse)
def resume_graph(request: ResumeRequest):
    config = {"configurable": {"thread_id": request.thread_id}}
    checkpoint = graph.get_state(config)
    if "human_feedback" not in (checkpoint.next or []):
        raise HTTPException(status_code=409, detail="该会话当前不在答案审核关卡")
    state = {"status": request.review_action}
    if request.human_comment is not None:
        state["human_comment"] = request.human_comment
    print(f"State to update: {state}")
    graph.update_state(config, state)

    return run_graph_and_response(None, config)


@router.post("/graph/plan-review", response_model=GraphResponse)
def review_plan(request: PlanReviewRequest):
    config = {"configurable": {"thread_id": request.thread_id}}
    checkpoint = graph.get_state(config)
    if "human_plan_review" not in (checkpoint.next or []):
        raise HTTPException(status_code=409, detail="该会话当前不在计划审核关卡")

    state_update = {
        "plan_review_action": request.plan_action,
        "plan_feedback": request.plan_feedback,
        "step_index": 0
    }
    if request.plan_action == "approved":
        state_update["plan_steps"] = [
            {
                "id": f"step_{index + 1}",
                "description": step.description,
                "status": "pending",
                "result": None,
                "error": None
            }
            for index, step in enumerate(request.plan_steps)
        ]
    graph.update_state(config, state_update)
    return run_graph_and_response(None, config)
