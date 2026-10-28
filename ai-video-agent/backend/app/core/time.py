"""时间工具：全系统统一使用带时区的 UTC 时间。"""
from datetime import UTC, datetime


def utcnow() -> datetime:
    return datetime.now(UTC)
