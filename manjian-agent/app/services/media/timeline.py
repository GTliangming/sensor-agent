"""时间轴计算（场景间交叉淡化下的统一时序）。

渲染的 xfade/acrossfade 与字幕 SRT 必须用同一套时序，否则字幕会漂移。
交叉淡化会让相邻片段重叠 T 秒，总时长 = sum(durations) - (n-1)*T。
"""
from __future__ import annotations


def effective_transition(durations: list[float], configured: float) -> float:
    """把配置的过渡时长按最短片段收敛，保证 xfade/acrossfade 合法。"""
    if len(durations) < 2 or configured <= 0:
        return 0.0
    return max(0.0, min(configured, min(durations) * 0.5))


def scene_starts(durations: list[float], t: float) -> list[float]:
    """每个场景在最终合成时间轴上的起点（也正是 xfade 的 offset 序列，去掉首个）。"""
    starts: list[float] = []
    cursor = 0.0
    for i, d in enumerate(durations):
        starts.append(round(cursor, 3))
        if i < len(durations) - 1:
            cursor += d - t
    return starts


def total_duration(durations: list[float], t: float) -> float:
    if not durations:
        return 0.0
    n = len(durations)
    return round(sum(durations) - t * (n - 1 if n > 1 else 0), 3)
