import json
import os
import sqlite3
from typing import Literal, Optional
from dotenv import load_dotenv, find_dotenv
from langgraph.graph import StateGraph, MessagesState, START, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.checkpoint.sqlite import SqliteSaver
from app.persistence import STATE_DB

# 加载 .env（从当前目录向上查找，命中项目根目录的 .env），使 DEEPSEEK_* 等变量可用。
load_dotenv(find_dotenv())

# --- Model Definition ---
# 使用 DeepSeek 的 OpenAI 兼容接口：复用 .env 中的 DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL / DEEPSEEK_MODEL。
# ChatOpenAI 支持自定义 base_url，因此可直接指向 DeepSeek 网关，无需真正的 OpenAI 账号。
model = ChatOpenAI(
    model=os.getenv("DEEPSEEK_MODEL", "deepseek-chat"),
    api_key=os.getenv("DEEPSEEK_API_KEY"),
    base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
)


# --- Graph State Definition ---
class DraftReviewState(MessagesState):
    human_request: str
    plan_steps: list[dict]
    plan_review_action: Optional[Literal["approved", "replan"]]
    plan_feedback: Optional[str]
    step_index: int
    human_comment: Optional[str]
    status: Literal["approved", "feedback"]
    assistant_response: str


# --- Graph Nodes Definition ---
def parse_plan_steps(content: str) -> list[dict]:
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as error:
        raise ValueError("assistant_plan 必须返回 JSON 对象，格式为 {\"steps\": [\"...\"]}") from error

    raw_steps = parsed.get("steps") if isinstance(parsed, dict) else None
    if not isinstance(raw_steps, list) or not 1 <= len(raw_steps) <= 7:
        raise ValueError("计划必须包含 1 到 7 个步骤")

    steps = []
    for index, raw_step in enumerate(raw_steps):
        description = raw_step.strip() if isinstance(raw_step, str) else ""
        if not description or len(description) > 500:
            raise ValueError(f"第 {index + 1} 个计划步骤为空或超过 500 个字符")
        steps.append({
            "id": f"step_{index + 1}",
            "description": description,
            "status": "pending",
            "result": None,
            "error": None
        })
    return steps


def assistant_plan(state: DraftReviewState) -> DraftReviewState:
    plan_prompt = SystemMessage(content="""
    Create a concise, user-visible execution plan for the request.
    Return only a JSON object with a "steps" array containing 2 to 5 short strings.
    Do not include hidden chain-of-thought or private reasoning. Do not answer yet.
    If human feedback is provided, revise the prior plan to address it.
    """)
    planning_context = {
        "human_request": state["human_request"],
        "previous_plan": [
            step["description"] for step in state.get("plan_steps", [])
        ],
        "human_feedback": state.get("plan_feedback")
    }
    last_error = None
    plan_steps = None
    request_message = HumanMessage(content=json.dumps(planning_context, ensure_ascii=False))
    for attempt in range(2):
        prompt_messages = [plan_prompt, request_message]
        if last_error:
            prompt_messages.append(SystemMessage(content=(
                f"Your previous plan was invalid: {last_error}. "
                "Return a valid JSON object with a steps array only."
            )))
        plan_content = model.invoke(prompt_messages).content
        if not isinstance(plan_content, str):
            last_error = "planner output must be text JSON"
            continue
        try:
            plan_steps = parse_plan_steps(plan_content)
            break
        except ValueError as error:
            last_error = str(error)
    if plan_steps is None:
        raise ValueError(f"assistant_plan 两次输出都未通过校验: {last_error}")

    return {
        **state,
        "plan_steps": plan_steps,
        "plan_review_action": None,
        "plan_feedback": None,
        "step_index": 0
    }


def human_plan_review(state: DraftReviewState):
    pass


def plan_review_router(state: DraftReviewState) -> str:
    if state.get("plan_review_action") == "replan":
        return "assistant_plan"
    return "assistant_execute_step"


def assistant_execute_step(state: DraftReviewState) -> DraftReviewState:
    step_index = state["step_index"]
    steps = [dict(step) for step in state["plan_steps"]]
    if not 0 <= step_index < len(steps):
        raise ValueError(f"计划步骤索引无效: {step_index}")

    step = steps[step_index]
    step["status"] = "running"
    execution_prompt = SystemMessage(content="""
    Complete exactly one plan step using the user's request and available prior step results.
    Return the result for this step only. Do not claim external actions were performed
    unless a provided tool actually performed them.
    """)
    execution_input = {
        "human_request": state["human_request"],
        "plan_step": step["description"],
        "previous_results": [
            {"description": item["description"], "result": item.get("result")}
            for item in steps[:step_index]
        ]
    }
    try:
        response = model.invoke([
            execution_prompt,
            HumanMessage(content=json.dumps(execution_input, ensure_ascii=False))
        ])
        result_content = response.content
        if not isinstance(result_content, str):
            result_content = json.dumps(result_content, ensure_ascii=False)
        if not result_content.strip():
            raise ValueError("执行节点返回了空结果")
        step["status"] = "completed"
        step["result"] = result_content
    except Exception as error:
        step["status"] = "failed"
        step["error"] = f"{type(error).__name__}: {str(error)[:300]}"
    return {
        **state,
        "plan_steps": steps,
        "step_index": step_index + 1
    }


def execution_router(state: DraftReviewState) -> str:
    if state["step_index"] < len(state["plan_steps"]):
        return "assistant_execute_step"
    return "assistant_draft"


def assistant_draft(state: DraftReviewState) -> DraftReviewState:
    system_message = SystemMessage(content=f"""
    Synthesize a clear draft answer using the user's request, approved plan,
    and the completed result for every plan step.
    Plan and step results:
    {json.dumps(state["plan_steps"], ensure_ascii=False)}

    Human feedback from the answer review, if any, takes priority:
    {state.get("human_comment") or "No answer-review feedback yet."}
    If any step failed or is still pending, clearly disclose the incomplete work.
    Do not claim work beyond the recorded step results.
    """)
    messages = [
        system_message,
        HumanMessage(content=state["human_request"]),
        *state["messages"]
    ]
    response = model.invoke(messages)
    return {
        **state,
        "messages": state["messages"] + [response],
        "assistant_response": response.content
    }


def human_feedback(state: DraftReviewState):
    pass


def assistant_finalize(state: DraftReviewState) -> DraftReviewState:
    # Get the most recent assistant response from the state
    latest_response = state["assistant_response"]
    
    system_message = SystemMessage(content="""
    You are an AI assistant. The user has approved your draft. Carefully 
    review your reply and make any final improvements to clarity, tone, and 
    completeness. Ensure the response is polished, professional, and ready 
    to be delivered as the final answer.
    
    DO NOT expand the response significantly or revert to earlier versions.
    Focus on polishing the MOST RECENT draft that was approved.
    """)
    
    # Create a focused message list with just the original request and latest response
    user_message = HumanMessage(content=state["human_request"])
    assistant_message = HumanMessage(content=f"My previous draft: {latest_response}")
    
    # Use a more focused set of messages for the finalize step
    messages = [system_message, user_message, assistant_message]
    response = model.invoke(messages)

    # Add the finalized response to the message history
    all_messages = state['messages'] + [response]

    return {
        **state,
        "messages": all_messages,
        "assistant_response": response.content
    }
    

# --- Router Function ---
def feedback_router(state: DraftReviewState) -> str:
    if state['status'] == 'approved':
        return 'assistant_finalize'
    else:
        return 'assistant_draft'

# --- Graph Construction ---
builder = StateGraph(DraftReviewState)

builder.add_node("assistant_plan", assistant_plan)
builder.add_node("human_plan_review", human_plan_review)
builder.add_node("assistant_execute_step", assistant_execute_step)
builder.add_node('assistant_draft', assistant_draft)
builder.add_node('human_feedback', human_feedback)
builder.add_node('assistant_finalize', assistant_finalize)

builder.add_edge(START, "assistant_plan")
builder.add_edge("assistant_plan", "human_plan_review")
builder.add_conditional_edges(
    "human_plan_review",
    plan_review_router,
    {
        "assistant_plan": "assistant_plan",
        "assistant_execute_step": "assistant_execute_step"
    }
)
builder.add_conditional_edges(
    "assistant_execute_step",
    execution_router,
    {
        "assistant_execute_step": "assistant_execute_step",
        "assistant_draft": "assistant_draft"
    }
)
builder.add_edge('assistant_draft', 'human_feedback')
builder.add_conditional_edges('human_feedback', feedback_router, {'assistant_finalize': 'assistant_finalize', 'assistant_draft': 'assistant_draft'})
builder.add_edge('assistant_finalize', END)

checkpoint_connection = sqlite3.connect(STATE_DB, check_same_thread=False, timeout=30)
checkpointer = SqliteSaver(checkpoint_connection)
checkpointer.setup()
graph = builder.compile(
    interrupt_before=["human_plan_review", "human_feedback"],
    checkpointer=checkpointer
)

# --- Exports ---
__all__ = ["graph", "DraftReviewState"]
