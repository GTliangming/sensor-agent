"""消息（Message）仓储层：封装对 messages 表的读写。

同会话仓储一样，只管数据存取、不含业务规则、不自己 commit，
事务由上层统一控制。消息只增不改（见 Message 模型只带 created_at）。
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Message


async def create(
    db: AsyncSession,
    conversation_id: str,
    role: str,
    content: str,
    *,  # 之后的参数必须用关键字传：create(db, cid, "user", "hi", run_id="...")
    run_id: str | None = None,  # 关联的 Agent 运行；用户消息没有 run，故可空
    content_type: str = "text",
) -> Message:
    """新增一条消息并写入。"""
    message = Message(
        conversation_id=conversation_id,
        role=role,
        content=content,
        run_id=run_id,
        content_type=content_type,
    )
    db.add(message)
    await db.flush()  # 生成主键 id（不提交），提交交给上层
    return message


async def list_by_conversation(
    db: AsyncSession,
    conversation_id: str,
    limit: int = 200,
) -> list[Message]:
    """按时间正序取某会话的消息（最早在前），最多 limit 条。"""
    result = await db.execute(
        select(Message)
        .where(
            Message.conversation_id == conversation_id,
        )
        .order_by(Message.created_at.asc())  # 升序：从旧到新
        .limit(limit)
    )
    return list(result.scalars().all())


async def list_recent(
    db: AsyncSession,
    conversation_id: str,
    limit: int,
) -> list[Message]:
    """取某会话「最近」的 limit 条消息，返回时再调成时间正序。

    用途：喂给 LLM 的上下文窗口有限，只带最近 N 条，所以先按时间
    倒序 + limit 取到最新的若干条，再 reverse() 还原成「旧→新」顺序，
    这样对话历史读起来才连贯。
    """
    result = await db.execute(
        select(Message)
        .where(
            Message.conversation_id == conversation_id,
        )
        .order_by(Message.created_at.desc())  # 降序：先拿到最新的 limit 条
        .limit(limit)
    )
    messages = list(result.scalars().all())
    messages.reverse()  # 再翻转成「旧→新」，符合对话阅读顺序
    return messages