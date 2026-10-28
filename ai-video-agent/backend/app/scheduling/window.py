"""夜间生成窗口：只决定“什么时候允许向 AutoDL 提交新任务”。

AutoDL 无法通过 API 启停实例，所以这里不做开关机，只做提交时间的控制。
窗口可跨天（如 23:00-07:00）。起止相同表示窗口为空（永远关闭），仅用于测试。
"""
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.core.config import Settings


def _parse(hhmm: str) -> time:
    h, m = hhmm.split(":")
    return time(int(h), int(m))


def is_window_open(now: datetime, s: Settings) -> bool:
    if not s.generation_window_enabled:
        return True
    start, end = _parse(s.generation_window_start), _parse(s.generation_window_end)
    local = now.astimezone(ZoneInfo(s.timezone)).time()
    if start < end:
        return start <= local < end
    if start == end:
        return False
    return local >= start or local < end  # 跨天窗口


def next_window_start(now: datetime, s: Settings) -> datetime:
    """下一次允许提交的时间（UTC）。窗口已开则返回 now。窗口为空时返回 now 以免误导。"""
    if is_window_open(now, s) or s.generation_window_start == s.generation_window_end:
        return now
    tz = ZoneInfo(s.timezone)
    local = now.astimezone(tz)
    start = datetime.combine(local.date(), _parse(s.generation_window_start), tzinfo=tz)
    if start <= local:
        start += timedelta(days=1)
    return start.astimezone(now.tzinfo)
