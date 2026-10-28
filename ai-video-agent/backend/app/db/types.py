"""跨数据库一致的自定义列类型。"""
from datetime import UTC, datetime

from sqlalchemy import DateTime
from sqlalchemy.types import TypeDecorator


class UTCDateTime(TypeDecorator):
    """存储为 naive UTC，读取时还原为带时区的 UTC。

    SQLite 不保存时区信息；PostgreSQL 的 timestamp without time zone 同理。
    统一在类型层处理，业务代码就不用关心数据库差异。
    """

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("必须传入带时区的 datetime（请使用 app.core.time.utcnow）")
        return value.astimezone(UTC).replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect):
        if value is None:
            return None
        return value.replace(tzinfo=UTC)
