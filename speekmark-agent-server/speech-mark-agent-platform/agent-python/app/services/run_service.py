import logging
from datetime import UTC, datetime
from time import perf_counter
from uuid import uuid4

from langchain_core.messages import AIMessage, ToolMessage

from app.core.config import settings
from app.graph.workflow import run_deepseek_agent, run_demo_agent
from app.schemas.run import CreateRunRequest, RunResponse, TraceEvent

logger = logging.getLogger(__name__)
_RUNS: dict[str, RunResponse] = {}
_TRACES: dict[str, list[TraceEvent]] = {}


def _event(
    run_id: str,
    seq: int,
    kind: str,
    node: str,
    title: str,
    detail: str,
    duration_ms: int = 0,
    tool_call_id: str | None = None,
    input_summary: str | None = None,
    output_summary: str | None = None,
) -> TraceEvent:
    return TraceEvent(
        event_id=f"evt_{uuid4().hex}",
        run_id=run_id,
        seq=seq,
        type=kind,
        node=node,
        title=title,
        detail=detail,
        status="succeeded",
        duration_ms=duration_ms,
        tool_call_id=tool_call_id,
        input_summary=input_summary,
        output_summary=output_summary,
        created_at=datetime.now(UTC),
    )


def _extract_tokens(messages: list) -> int:
    total = 0
    for message in messages:
        if isinstance(message, AIMessage):
            usage = getattr(message, "usage_metadata", None) or {}
            total += int(usage.get("total_tokens", 0) or 0)
            if not usage and isinstance(getattr(message, "response_metadata", None), dict):
                token_usage = message.response_metadata.get("token_usage", {})
                total += int(token_usage.get("total_tokens", 0) or 0)
    return total


def _build_model_trace(run_id: str, input_text: str, messages: list, elapsed_ms: int) -> tuple[list[TraceEvent], int, int]:
    events: list[TraceEvent] = [
        _event(run_id, 1, "run.started", "agent", "开始执行", "任务已交给 DeepSeek Agent。", input_summary=input_text)
    ]
    seq = 2
    tool_count = 0
    for message in messages:
        if isinstance(message, AIMessage):
            tool_calls = getattr(message, "tool_calls", []) or []
            if tool_calls:
                for call in tool_calls:
                    tool_count += 1
                    tool_name = call.get("name", "unknown_tool")
                    call_id = call.get("id") or f"tool_{uuid4().hex[:12]}"
                    events.append(
                        _event(
                            run_id, seq, "tool.started", tool_name, f"调用工具：{tool_name}",
                            "DeepSeek 请求调用工具。", tool_call_id=call_id,
                            input_summary=str(call.get("args", {}))[:1000],
                        )
                    )
                    seq += 1
            else:
                events.append(
                    _event(run_id, seq, "node.completed", "llm", "模型生成内容", "收到模型消息。", elapsed_ms)
                )
                seq += 1
        elif isinstance(message, ToolMessage):
            events.append(
                _event(
                    run_id, seq, "tool.completed", message.name or "tool", "工具执行完成",
                    "工具已返回结果。", tool_call_id=message.tool_call_id,
                    output_summary=str(message.content)[:1000],
                )
            )
            seq += 1
    events.append(_event(run_id, seq, "run.completed", "agent", "任务执行完成", "DeepSeek Agent 已返回最终回答。", elapsed_ms))
    return events, tool_count, _extract_tokens(messages)


def create_run(req: CreateRunRequest) -> RunResponse:
    run_id = req.run_id or f"run_{uuid4().hex}"
    started = datetime.now(UTC)
    _RUNS[run_id] = RunResponse(run_id=run_id, input=req.input, status="running", started_at=started)
    begin = perf_counter()
    try:
        if settings.model_enabled:
            result = run_deepseek_agent(req.input)
            messages = result["messages"]
            elapsed = int((perf_counter() - begin) * 1000)
            events, tool_count, tokens = _build_model_trace(run_id, req.input, messages, elapsed)
            answer = result["answer"]
        else:
            result = run_demo_agent(req.input)
            elapsed = int((perf_counter() - begin) * 1000)
            answer = result["answer"]
            tool_count = 1 if "命中业务知识" in result.get("tool_summary", "") else 0
            tokens = 0
            events = [
                _event(run_id, 1, "run.started", "agent", "开始执行", "Agent 已接收任务并初始化工作流。"),
                _event(run_id, 2, "node.completed", "classify", "识别任务意图", result.get("tool_summary", "已完成"), elapsed),
            ]
            if tool_count:
                call_id = f"tool_{uuid4().hex[:12]}"
                events.extend([
                    _event(run_id, 3, "tool.started", "search_annotation_sop", "调用工具：检索标注规范", "根据用户问题检索示例 SOP。", tool_call_id=call_id, input_summary=req.input),
                    _event(run_id, 4, "tool.completed", "search_annotation_sop", "工具返回检索结果", "已从示例知识库返回摘要。", tool_call_id=call_id, input_summary=req.input, output_summary="返回一条 SOP 示例摘要"),
                ])
            events.append(_event(run_id, len(events) + 1, "node.completed", "respond", "生成回答", "已生成最终答复。"))
            events.append(_event(run_id, len(events) + 1, "run.completed", "agent", "任务执行完成", "演示工作流已结束。", elapsed))

        finished = datetime.now(UTC)
        run = RunResponse(
            run_id=run_id, input=req.input, status="succeeded", final_answer=answer,
            started_at=started, finished_at=finished,
            duration_ms=int((finished - started).total_seconds() * 1000),
            steps=len(events), tools=tool_count, tokens=tokens,
        )
        _RUNS[run_id] = run
    except Exception as exc:  # noqa: BLE001 - log detail server-side; return a safe client message
        logger.exception("Agent run failed: run_id=%s", run_id)
        finished = datetime.now(UTC)
        message = str(exc) if isinstance(exc, RuntimeError) else "请检查 DeepSeek 配置、网络连接和服务日志。"
        _RUNS[run_id] = RunResponse(
            run_id=run_id, input=req.input, status="failed", error=message,
            started_at=started, finished_at=finished,
            duration_ms=int((finished - started).total_seconds() * 1000),
        )
        events = [
            _event(run_id, 1, "run.started", "agent", "开始执行", "Agent 已接收任务。"),
            _event(run_id, 2, "run.failed", "agent", "任务执行失败", message),
        ]
    _TRACES[run_id] = events
    return _RUNS[run_id]


def get_run(run_id: str) -> RunResponse | None:
    return _RUNS.get(run_id)


def get_trace(run_id: str) -> list[TraceEvent] | None:
    return _TRACES.get(run_id)
