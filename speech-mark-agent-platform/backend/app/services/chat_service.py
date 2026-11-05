"""对话服务层（chat service）：编排「会话 / 消息 / 运行」与 LLM 调用。

职责分层：路由只调这里的函数；本层负责业务编排与事务边界（commit），
真正的数据库读写交给 repositories，模型调用交给注入进来的 ChatClient。
"""

from collections.abc import Sequence
from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.error_catalog import ErrorCode
from app.core.errors import AppError
from app.integrations.llm.types import LLMMessage, LLMResult
from app.prompts.system import SYSTEM_PROMPT
from app.repositories import agent_run as agent_run_repo
from app.repositories import conversation as conversation_repo
from app.repositories import message as message_repo
from app.schemas.agent import MessageDTO, RunDTO, ThreadDTO


class ChatClient(Protocol):
    """LLM 客户端的最小协议：只要有这样签名的 chat 方法即可（结构化类型）。

    用 Protocol 而不是直接依赖 DeepSeekClient，是为了解耦——
    测试时能传入任意「假客户端」，不必改本模块。
    """

    async def chat(
        self,
        messages: Sequence[LLMMessage],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> LLMResult: ...


async def create_thread(
    db: AsyncSession,
    user_id: str,
    title: str,
) -> ThreadDTO:
    """新建会话；标题去空白后为空则回退「新会话」。"""
    resolved_title = title.strip() or "新会话"
    conversation = await conversation_repo.create(db, user_id, resolved_title)
    await db.commit()
    await db.refresh(conversation)  # 取回数据库侧生成的时间戳等字段
    return ThreadDTO.model_validate(conversation)


async def list_threads(
    db: AsyncSession,
    user_id: str,
) -> list[ThreadDTO]:
    """列出当前用户的会话，转成对外 DTO。"""
    rows = await conversation_repo.list_by_user(db, user_id)
    return [ThreadDTO.model_validate(row) for row in rows]


async def list_messages(
    db: AsyncSession,
    user_id: str,
    thread_id: str,
) -> list[MessageDTO]:
    """列出某会话的消息；先校验会话归属，防越权读他人会话。"""
    conversation = await conversation_repo.get_owned(db, thread_id, user_id)
    if conversation is None:
        raise AppError(ErrorCode.NOT_FOUND, "会话不存在", status_code=404)

    rows = await message_repo.list_by_conversation(db, thread_id)
    return [MessageDTO.model_validate(row) for row in rows]


async def get_run(
    db: AsyncSession,
    user_id: str,
    run_id: str,
) -> RunDTO:
    """按 id 取一次运行记录；同样带归属校验。"""
    run = await agent_run_repo.get_owned(db, run_id, user_id)
    if run is None:
        raise AppError(ErrorCode.NOT_FOUND, "运行记录不存在", status_code=404)
    return RunDTO.model_validate(run)


async def run_chat(
    db: AsyncSession,
    user_id: str,
    thread_id: str,
    messages: str,
    llm: ChatClient,
) -> RunDTO:
    """执行一次问答：落库 → 组上下文 → 调模型 → 记录结果，返回运行 DTO。"""
    # 校验会话归属
    conversation = await conversation_repo.get_owned(db, thread_id, user_id)
    if conversation is None:
        raise AppError(ErrorCode.NOT_FOUND, "会话不存在", status_code=404)

    question = messages.strip()
    if not question:
        raise AppError(ErrorCode.BAD_REQUEST, "问题不能为空", status_code=400)

    # 1) 先落 run 和用户消息，并提交；不要在持有事务时等待模型
    #    （LLM 调用可能耗时数十秒，占着数据库事务/连接是大忌）
    run = await agent_run_repo.create(db, conversation.id, user_id, question)
    await message_repo.create(
        db,
        conversation.id,
        "user",
        question,
        run_id=run.id,
    )
    await db.commit()

    # 2) 组装上下文：system 提示词 + 最近 N 条 user/assistant 历史消息。
    #    N 来自配置 llm_context_messages，至少取 1 条。
    settings = get_settings()
    limit = max(1, settings.llm_context_messages)
    history = await message_repo.list_recent(db, conversation.id, limit)

    llm_messages: list[LLMMessage] = [
        LLMMessage(role="system", content=SYSTEM_PROMPT),
    ]
    # 只带 user / assistant 历史（历史里本就不存 system；系统提示词上面已单独加）
    llm_messages.extend(
        LLMMessage(role=row.role, content=row.content)
        for row in history
        if row.role in ("user", "assistant")
    )

    # 3) 调用模型；无论哪种失败都要先把 run 标成 failed 再抛出
    try:
        result = await llm.chat(llm_messages)
    except AppError as exc:
        # 已是业务错误：原样记录错误码/信息并透传给上层
        agent_run_repo.mark_failed(
            run,
            error_code=str(exc.code),
            error_message=exc.message,
        )
        await db.commit()
        raise
    except Exception as exc:
        # 兜底未知异常：记为内部错误，对外统一回 502
        agent_run_repo.mark_failed(
            run,
            error_code=str(ErrorCode.LLM_UPSTREAM_ERROR),
            error_message="模型调用失败",
        )
        await db.commit()
        raise AppError(
            ErrorCode.LLM_UPSTREAM_ERROR,
            "模型调用失败，请稍后重试",
            status_code=502,
        ) from exc

    # 4) 成功：写 run 结果、助手消息、刷新会话活跃时间，一次性提交
    agent_run_repo.mark_succeeded(
        run,
        answer=result.content,
        model=result.model,
        input_tokens=result.input_tokens,
        output_tokens=result.output_tokens,
        latency_ms=result.latency_ms,
    )
    await message_repo.create(
        db,
        conversation.id,
        "assistant",
        result.content,
        run_id=run.id,
    )
    conversation_repo.touch(conversation)
    await db.commit()
    await db.refresh(run)

    return RunDTO.model_validate(run)
