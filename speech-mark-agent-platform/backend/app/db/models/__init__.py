"""ORM 模型统一出口。

集中导入所有模型，一是方便外部用 `from app.db.models import User` 直接取用，
二是确保建表/迁移前这些表都已注册到 Base.metadata（否则未被导入的模型不会建表）。
"""

from app.db.models.agent_run import AgentRun
from app.db.models.conversation import Conversation
from app.db.models.message import Message
from app.db.models.user import User
from app.db.models.user_platform_binding import UserPlatformBinding

__all__ = [
    "AgentRun",
    "Conversation",
    "Message",
    "User",
    "UserPlatformBinding",
]