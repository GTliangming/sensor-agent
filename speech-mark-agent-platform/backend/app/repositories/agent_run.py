"""Agent 运行（AgentRun）仓储层：封装对 agent_runs 表的读写。

同其他仓储：只管数据存取、不含业务规则、不自己 commit。
一次运行的生命周期：create(running) → mark_succeeded / mark_failed。
"""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AgentRun


async def create(
    db: AsyncSession,
    conversation_id: str,
    user_id: str,
    question: str,
) -> AgentRun:
    """新建一次运行记录，初始状态即 running 并记录开始时间。"""
    run = AgentRun(
        conversation_id=conversation_id,
        user_id=user_id,
        question=question,
        status="running",
        started_at=datetime.now(UTC),
    )
    db.add(run)
    await db.flush()  # 生成主键 id（不提交），提交交给上层
    return run


def mark_succeeded(
    run: AgentRun,
    *,  # 以下均为关键字参数，调用时必须写参数名，避免一堆同类型值传错位
    answer: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    latency_ms: int,
) -> None:
    """把运行标记为成功，写入回答与各项指标（纯内存修改，落库靠上层 commit）。"""
    run.status = "succeeded"
    run.answer = answer
    run.model = model
    run.input_tokens = input_tokens
    run.output_tokens = output_tokens
    run.latency_ms = latency_ms
    run.finished_at = datetime.now(UTC)  # 模型列名是 finished_at（不是 ended_at）


def mark_failed(
    run: AgentRun,
    *,  # 关键字参数，调用时必须写参数名
    error_code: str,
    error_message: str,
) -> None:
    """把运行标记为失败，写入错误码与错误信息（纯内存修改，落库靠上层 commit）。"""
    run.status = "failed"
    run.error_code = error_code
    run.error_message = error_message
    run.finished_at = datetime.now(UTC)


async def get_owned(
    db: AsyncSession,
    run_id: str,
    user_id: str,
) -> AgentRun | None:
    """按 id + 归属用户取回一次运行；带越权防护，查不到或不属于该用户返回 None。"""
    result = await db.execute(
        select(AgentRun).where(
            AgentRun.id == run_id,
            AgentRun.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()