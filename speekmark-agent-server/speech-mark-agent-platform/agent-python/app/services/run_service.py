"""运行编排服务：串联 Agent 工作流，生成一次运行的结果与执行轨迹（Trace）。

本模块是连接 API 层与 Agent 工作流的中间层，职责包括：
- 触发真实模型或确定性演示两条执行路径；
- 把模型返回的 LangChain 消息转换成结构化的 Trace 事件；
- 统计步数、工具调用次数与 token 消耗；
- 用内存字典保存运行结果和轨迹（演示用，进程重启即丢失）。
"""

import logging
from datetime import UTC, datetime
from time import perf_counter
from uuid import uuid4

# LangChain 消息类型：AIMessage 代表模型输出（可能含工具调用），
# ToolMessage 代表工具执行后的返回结果。
from langchain_core.messages import AIMessage, ToolMessage

from app.core.config import settings
from app.graph.workflow import run_deepseek_agent, run_demo_agent
from app.schemas.run import CreateRunRequest, RunResponse, TraceEvent

logger = logging.getLogger(__name__)
# 内存版存储：以 run_id 为键分别缓存运行结果与轨迹事件；仅适合演示/开发。
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
    """构造一条 Trace 事件。

    统一在此生成 event_id、时间戳并填充默认字段，让各处轨迹拼装保持一致。
    seq 表示事件在一次运行内的顺序号，node 表示产生该事件的逻辑节点。
    """
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
    """从模型消息中累加 token 消耗。

    优先读取 usage_metadata.total_tokens；缺失时回退到 response_metadata 中
    OpenAI 风格的 token_usage.total_tokens，以兼容不同返回结构。
    """
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
    """把真实模型返回的消息序列还原成可视化的执行轨迹。

    遍历 LangChain 消息：AIMessage 若带 tool_calls 则展开为"工具开始"事件，
    否则视为一次模型内容生成；ToolMessage 则对应"工具完成"事件。
    返回 (事件列表, 工具调用次数, token 总数)。
    """
    # 轨迹以一条"开始执行"事件打头，记录原始输入。
    events: list[TraceEvent] = [
        _event(run_id, 1, "run.started", "agent", "开始执行", "任务已交给 DeepSeek Agent。", input_summary=input_text)
    ]
    seq = 2
    tool_count = 0
    for message in messages:
        if isinstance(message, AIMessage):
            # 取出本条 AI 消息请求的工具调用；可能为空。
            tool_calls = getattr(message, "tool_calls", []) or []
            if tool_calls:
                # 模型决定调用工具：每个调用生成一条"工具开始"事件。
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
                # 没有工具调用，说明是一次纯文本内容生成。
                events.append(
                    _event(run_id, seq, "node.completed", "llm", "模型生成内容", "收到模型消息。", elapsed_ms)
                )
                seq += 1
        elif isinstance(message, ToolMessage):
            # 工具返回结果：与对应的 tool_call_id 关联，便于前端配对展示。
            events.append(
                _event(
                    run_id, seq, "tool.completed", message.name or "tool", "工具执行完成",
                    "工具已返回结果。", tool_call_id=message.tool_call_id,
                    output_summary=str(message.content)[:1000],
                )
            )
            seq += 1
    # 以一条"任务完成"事件收尾。
    events.append(_event(run_id, seq, "run.completed", "agent", "任务执行完成", "DeepSeek Agent 已返回最终回答。", elapsed_ms))
    return events, tool_count, _extract_tokens(messages)


def create_run(req: CreateRunRequest) -> RunResponse:
    """执行一次 Agent 运行：按配置选择模型/演示路径，并落地结果与轨迹。

    成功分支生成完整轨迹与统计信息；异常分支捕获错误、记录服务端日志，并对外
    返回可安全展示的失败信息。无论成败都会写入内存存储。
    """
    # 未显式传入 run_id 时自动生成一个，并先登记为"running"状态。
    run_id = req.run_id or f"run_{uuid4().hex}"
    started = datetime.now(UTC)
    _RUNS[run_id] = RunResponse(run_id=run_id, input=req.input, status="running", started_at=started)
    begin = perf_counter()
    try:
        if settings.model_enabled:
            # 真实模型路径：调用 DeepSeek，再把返回消息转成轨迹。
            result = run_deepseek_agent(req.input)
            messages = result["messages"]
            elapsed = int((perf_counter() - begin) * 1000)
            events, tool_count, tokens = _build_model_trace(run_id, req.input, messages, elapsed)
            answer = result["answer"]
        else:
            # 演示路径：用确定性工作流手工拼装轨迹，token 恒为 0。
            result = run_demo_agent(req.input)
            elapsed = int((perf_counter() - begin) * 1000)
            answer = result["answer"]
            # 依据分类摘要判断是否命中了"检索"分支，从而决定工具计数。
            tool_count = 1 if "命中业务知识" in result.get("tool_summary", "") else 0
            tokens = 0
            events = [
                _event(run_id, 1, "run.started", "agent", "开始执行", "Agent 已接收任务并初始化工作流。"),
                _event(run_id, 2, "node.completed", "classify", "识别任务意图", result.get("tool_summary", "已完成"), elapsed),
            ]
            if tool_count:
                # 命中检索时补充一对"工具开始/完成"事件，模拟真实调用轨迹。
                call_id = f"tool_{uuid4().hex[:12]}"
                events.extend([
                    _event(run_id, 3, "tool.started", "search_annotation_sop", "调用工具：检索标注规范", "根据用户问题检索示例 SOP。", tool_call_id=call_id, input_summary=req.input),
                    _event(run_id, 4, "tool.completed", "search_annotation_sop", "工具返回检索结果", "已从示例知识库返回摘要。", tool_call_id=call_id, input_summary=req.input, output_summary="返回一条 SOP 示例摘要"),
                ])
            events.append(_event(run_id, len(events) + 1, "node.completed", "respond", "生成回答", "已生成最终答复。"))
            events.append(_event(run_id, len(events) + 1, "run.completed", "agent", "任务执行完成", "演示工作流已结束。", elapsed))

        # 成功收尾：汇总耗时、步数、工具数与 token，覆盖此前的 running 记录。
        finished = datetime.now(UTC)
        run = RunResponse(
            run_id=run_id, input=req.input, status="succeeded", final_answer=answer,
            started_at=started, finished_at=finished,
            duration_ms=int((finished - started).total_seconds() * 1000),
            steps=len(events), tools=tool_count, tokens=tokens,
        )
        _RUNS[run_id] = run
    except Exception as exc:  # noqa: BLE001 - log detail server-side; return a safe client message
        # 失败分支：服务端记录完整堆栈；对客户端仅返回精简且安全的错误信息。
        logger.exception("Agent run failed: run_id=%s", run_id)
        finished = datetime.now(UTC)
        # RuntimeError 多为可读的业务提示，可直接展示；其他异常统一兜底文案。
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
    # 无论成功失败，最后都把轨迹写入内存存储。
    _TRACES[run_id] = events
    return _RUNS[run_id]


def get_run(run_id: str) -> RunResponse | None:
    """按 run_id 查询运行结果，不存在时返回 None。"""
    return _RUNS.get(run_id)


def get_trace(run_id: str) -> list[TraceEvent] | None:
    """按 run_id 查询执行轨迹事件列表，不存在时返回 None。"""
    return _TRACES.get(run_id)
