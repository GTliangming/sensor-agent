"""会话（Conversation）仓储层：集中封装对 conversations 表的数据库读写。

仓储层只负责「怎么存取数据」，不含业务规则，也不自己 commit——
事务边界（commit/rollback）交给上层 service/请求依赖统一控制。
函数式写法（一组 async 函数，而非类），上层按 `conversation_repo.create(...)` 调用。
"""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Conversation


async def create(
    db: AsyncSession,
    user_id: str,
    title: str,
) -> Conversation:
    """新建会话并写入会话对象。"""
    conversation = Conversation(user_id=user_id, title=title)
    db.add(conversation)
    # flush：把 INSERT 发到数据库以生成主键 id（但不提交），
    # 这样调用方拿到的 conversation 已带 id，可继续关联其他数据
    await db.flush()
    return conversation


async def list_by_user(
    db: AsyncSession,
    user_id: str,
) -> list[Conversation]:
    """列出某用户的所有「活跃」会话，按最近更新倒序。"""
    result = await db.execute(
        select(Conversation)
        .where(
            Conversation.user_id == user_id,
            Conversation.status == "active",  # 只取未归档/未删除的
        )
        .order_by(Conversation.updated_at.desc())  # 最近活跃的排前面
    )
    # scalars()：取每行的 Conversation 实体本身（而非 (Conversation,) 元组）
    return list(result.scalars().all())


async def get_owned(
    db: AsyncSession,
    conversation_id: str,
    user_id: str,
) -> Conversation | None:
    """按 id 取会话，同时校验归属（user_id）——越权防护的关键。

    where 里带上 user_id，使得「查别人的会话」直接查不到（返回 None），
    而不是查到后再判断，天然杜绝越权访问。
    """
    result = await db.execute(
        select(Conversation)
        .where(
            Conversation.id == conversation_id,
            Conversation.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()  # 没有或不属于该用户都返回 None


def touch(conversation: Conversation) -> None:
    """标记有新消息；updated_at 由 onupdate 自动刷新。"""
    # 只改内存中的实体，落库由上层的 commit 完成（本函数非 async，不碰数据库）
    conversation.last_message_at = datetime.now(UTC)