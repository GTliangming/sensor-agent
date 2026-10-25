# Lesson 2: Advanced Streaming API with Server-Sent Events (SSE)
# Real-time streaming of LangGraph outputs using SSE

from fastapi import APIRouter, HTTPException, Request
from uuid import uuid4
from app.models import GraphResponse, PlanReviewRequest, ResumeRequest, StartRequest
from app.graph import graph
from app.persistence import delete_pending_run, get_pending_run, save_pending_run
from sse_starlette.sse import EventSourceResponse
import json

router = APIRouter()

@router.post("/graph/stream/create", response_model=GraphResponse)
def create_graph_streaming(request: StartRequest):
    thread_id = str(uuid4())
    save_pending_run(thread_id, {
        "type": "start",
        "human_request": request.human_request
    })
    
    return GraphResponse(
        thread_id=thread_id,
        run_status="pending", 
        assistant_response=None
    )

@router.post("/graph/stream/resume", response_model=GraphResponse)
def resume_graph_streaming(request: ResumeRequest):
    thread_id = request.thread_id
    checkpoint = graph.get_state({"configurable": {"thread_id": thread_id}})
    if "human_feedback" not in (checkpoint.next or []):
        raise HTTPException(status_code=409, detail="该会话当前不在答案审核关卡")

    save_pending_run(thread_id, {
        "type": "resume",
        "review_action": request.review_action,
        "human_comment": request.human_comment
    })
    
    return GraphResponse(
        thread_id=thread_id,
        run_status="pending",
        assistant_response=None
    )


@router.post("/graph/stream/plan-review", response_model=GraphResponse)
def submit_plan_review(request: PlanReviewRequest):
    checkpoint = graph.get_state({"configurable": {"thread_id": request.thread_id}})
    if "human_plan_review" not in (checkpoint.next or []):
        raise HTTPException(status_code=409, detail="该会话当前不在计划审核关卡")

    save_pending_run(request.thread_id, {
        "type": "plan_review",
        "plan_action": request.plan_action,
        "plan_steps": [step.model_dump() for step in request.plan_steps],
        "plan_feedback": request.plan_feedback
    })
    return GraphResponse(
        thread_id=request.thread_id,
        run_status="pending",
        assistant_response=None
    )


@router.get("/graph/stream/{thread_id}")
async def stream_graph(request: Request, thread_id: str):
    run_data = get_pending_run(thread_id)
    if run_data is None:
        raise HTTPException(status_code=404, detail="Thread ID not found or no pending graph run")
    config = {"configurable": {"thread_id": thread_id}}
    
    input_state = None
    if run_data["type"] == "start":
        event_type = "start"
        input_state = {"human_request": run_data["human_request"]}
    elif run_data["type"] == "plan_review":
        event_type = "resume"
        state_update = {
            "plan_review_action": run_data["plan_action"],
            "plan_feedback": run_data.get("plan_feedback"),
            "step_index": 0
        }
        if run_data["plan_action"] == "approved":
            state_update["plan_steps"] = [
                {
                    "id": f"step_{index + 1}",
                    "description": step["description"],
                    "status": "pending",
                    "result": None,
                    "error": None
                }
                for index, step in enumerate(run_data["plan_steps"])
            ]
        graph.update_state(config, state_update)
        existing_plan_steps = (graph.get_state(config).values or {}).get("plan_steps", [])
    else:
        event_type = "resume"

        state_update = {"status": run_data["review_action"]}
        if run_data["human_comment"] is not None:
            state_update["human_comment"] = run_data["human_comment"]
        
        graph.update_state(config, state_update)
        existing_plan_steps = (graph.get_state(config).values or {}).get("plan_steps", [])
        # For resume operations, we pass None as the input state
        # input_state is already None
    
    async def event_generator():       
        def trace_data(event_name, **details):
            return {
                "event": "trace",
                "data": json.dumps({
                    "step": event_name,
                    "thread_id": thread_id,
                    **details
                })
            }

        # Initial event with thread_id
        initial_data = json.dumps({"thread_id": thread_id})
        print(f"DEBUG: Sending initial {event_type} event with data: {initial_data}")

        yield {"event": event_type, "data": initial_data}
        yield trace_data(
            "run_started",
            run_type=run_data["type"],
            explanation="FastAPI 已按 thread_id 取到本轮配置，开始执行或恢复 LangGraph。"
        )
        
        try:
            if run_data["type"] == "start":
                yield trace_data(
                    "graph_input_prepared",
                    input_fields=list(input_state.keys()),
                    human_request=input_state["human_request"],
                    entry_node="assistant_plan",
                    explanation="首次运行以 human_request 作为 State，由 assistant_plan 先生成可检查的执行计划。"
                )
            elif run_data["type"] == "plan_review":
                yield trace_data(
                    "plan_review_applied",
                    state_update=state_update,
                    existing_plan_steps=existing_plan_steps,
                    explanation="计划审核决定已写入 checkpoint；将按确认后的计划执行，或按反馈重新规划。"
                )
            else:
                yield trace_data(
                    "checkpoint_updated",
                    state_update=state_update,
                    existing_plan_steps=existing_plan_steps,
                    explanation="答案审核决定已写入 checkpoint；图将从 human_feedback 暂停处继续。"
                )

            print(f"DEBUG: Starting to stream graph messages for thread_id={thread_id}")
            reported_nodes = set()
            for stream_mode, chunk in graph.stream(
                input_state,
                config,
                stream_mode=["messages", "updates"]
            ):
                if await request.is_disconnected():
                    print("DEBUG: Client disconnected, breaking stream loop")
                    break

                if stream_mode == "updates":
                    for node_name, node_update in chunk.items():
                        if node_name == "assistant_plan" and node_update.get("plan_steps"):
                            yield trace_data(
                                "plan_generated",
                                node=node_name,
                                plan_steps=node_update["plan_steps"],
                                explanation="assistant_plan 已把结构化步骤写入 State.plan_steps，等待人工审核。"
                            )
                        elif node_name == "assistant_execute_step":
                            completed_index = node_update.get("step_index", 0) - 1
                            steps = node_update.get("plan_steps", [])
                            if 0 <= completed_index < len(steps):
                                yield trace_data(
                                    "execution_step_completed",
                                    node=node_name,
                                    plan_step=steps[completed_index],
                                    step_index=completed_index,
                                    next_step_index=node_update.get("step_index", completed_index + 1),
                                    total_steps=len(steps),
                                    explanation="该计划步骤已执行，结果已写入 State.plan_steps。"
                                )
                    continue

                msg, metadata = chunk
                node_name = metadata.get("langgraph_node")
                if node_name in ["assistant_draft", "assistant_finalize"]:
                    if node_name not in reported_nodes:
                        reported_nodes.add(node_name)
                        yield trace_data(
                            "node_output_started",
                            node=node_name,
                            explanation="该节点已调用模型并开始产出消息；后续文本通过 token 事件发送。"
                        )
                    token_data = json.dumps({"content": msg.content})
                    print(f"DEBUG: Sending token event with data: {token_data[:30]}...")
                    yield {"event": "token", "data": token_data}
            
            # After streaming completes, check if human feedback is needed
            state = graph.get_state(config)
            state_values = state.values or {}
            yield trace_data(
                "checkpoint_saved",
                next_nodes=list(state.next or []),
                status=state_values.get("status"),
                has_assistant_response=bool(state_values.get("assistant_response")),
                explanation="本轮节点运行结束，LangGraph 已保存当前状态和下一步节点。"
            )
            if state.next and "human_plan_review" in state.next:
                status_data = json.dumps({
                    "status": "plan_review",
                    "plan_steps": state_values.get("plan_steps", [])
                })
                yield trace_data(
                    "awaiting_plan_review",
                    next_nodes=list(state.next),
                    plan_steps=state_values.get("plan_steps", []),
                    explanation="执行计划已生成并保存；图暂停等待人工确认、编辑或要求重新规划。"
                )
                yield {"event": "status", "data": status_data}
            elif state.next and 'human_feedback' in state.next:
                status_data = json.dumps({"status": "user_feedback"})
                yield trace_data(
                    "awaiting_human",
                    next_nodes=list(state.next),
                    explanation="图停在人工审核关卡，等待前端提交 approved 或 feedback。"
                )
                print(f"DEBUG: Sending status event (feedback): {status_data}")
                yield {"event": "status", "data": status_data}
            else:
                status_data = json.dumps({"status": "finished"})
                yield trace_data(
                    "run_finished",
                    next_nodes=list(state.next or []),
                    explanation="图已运行到 END。"
                )
                print(f"DEBUG: Sending status event (finished): {status_data}")
                yield {"event": "status", "data": status_data}
                
            delete_pending_run(thread_id)
                
        except Exception as e:
            print(f"DEBUG: Exception in event_generator: {str(e)}")
            yield trace_data(
                "backend_error",
                error_type=type(e).__name__,
                error=str(e),
                explanation="后端图运行或 SSE 生成过程中抛出异常。"
            )
            yield {"event": "error", "data": json.dumps({"error": str(e)})}
            
            delete_pending_run(thread_id)
    
    return EventSourceResponse(event_generator())
