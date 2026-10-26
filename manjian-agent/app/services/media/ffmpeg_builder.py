"""共享的 filter_complex 构建：场景间 xfade（视频）+ acrossfade（音频），或无过渡时 concat。

render 的两条路径（图片+独立音频 / 已含音轨的短片）只在"每路视频滤镜"和"音频输入引用"
上不同，过渡拼接逻辑完全一致，统一在此避免重复。
"""
from __future__ import annotations

from app.services.media.timeline import scene_starts


def build_crossfade(
    video_parts: list[str], audio_labels: list[str], durations: list[float], t: float,
) -> tuple[list[str], str, str]:
    """返回 (filter_parts, video_map_label, audio_map_label)。

    video_parts: 每路已产出 [v{i}] 的视频滤镜串；audio_labels: 每路音频输入引用，如 "[0:a]"。
    """
    n = len(video_parts)
    parts = list(video_parts)
    if n == 1:
        return parts, "[v0]", audio_labels[0]
    if t > 0:
        offsets = scene_starts(durations, t)[1:]
        prev = "[v0]"
        for k in range(1, n):
            lbl = f"[vx{k}]"
            parts.append(
                f"{prev}[v{k}]xfade=transition=fade:duration={t:.3f}:offset={offsets[k-1]:.3f}{lbl}")
            prev = lbl
        vlabel = prev
        aprev = audio_labels[0]
        for k in range(1, n):
            lbl = f"[ax{k}]"
            parts.append(f"{aprev}{audio_labels[k]}acrossfade=d={t:.3f}{lbl}")
            aprev = lbl
        return parts, vlabel, aprev
    vins = "".join(f"[v{i}]" for i in range(n))
    ains = "".join(audio_labels)
    parts.append(f"{vins}concat=n={n}:v=1:a=0[vout]")
    parts.append(f"{ains}concat=n={n}:v=0:a=1[aout]")
    return parts, "[vout]", "[aout]"
