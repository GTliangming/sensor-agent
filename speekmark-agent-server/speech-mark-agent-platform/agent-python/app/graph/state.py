from typing import TypedDict


class AgentState(TypedDict, total=False):
    run_id: str
    input: str
    mode: str
    answer: str
    tool_summary: str
    error: str
