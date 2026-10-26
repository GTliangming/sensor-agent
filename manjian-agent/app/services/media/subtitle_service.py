"""字幕服务（文档 08.2，阶段 4）。

按场景旁白片段生成 SRT，时间轴来自实际音频时长；并与渲染的交叉淡化共用 timeline，
使字幕与画面过渡对齐（过渡会让相邻片段重叠 T 秒，总时长相应缩短）。
"""
from __future__ import annotations

from pathlib import Path

from app.domain.plans import AudioPlan
from app.observability.logging import get_logger
from app.services.media.timeline import effective_transition, scene_starts

logger = get_logger(__name__)


def _ts(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def build_srt(audio_plan: AudioPlan, out_path: Path, transition_seconds: float = 0.0) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    segments = sorted(audio_plan.segments, key=lambda s: s["order"])
    durations = [float(s["duration_seconds"]) for s in segments]
    t = effective_transition(durations, transition_seconds)
    starts = scene_starts(durations, t)

    lines: list[str] = []
    for idx, (seg, start, dur) in enumerate(zip(segments, starts, durations, strict=False), start=1):
        lines.append(str(idx))
        lines.append(f"{_ts(start)} --> {_ts(start + dur)}")
        lines.append(seg["text"].strip())
        lines.append("")
    out_path.write_text("\n".join(lines), encoding="utf-8")
    logger.info("字幕生成 %s 段（过渡 %.2fs）-> %s", len(segments), t, out_path.name)
    return out_path
