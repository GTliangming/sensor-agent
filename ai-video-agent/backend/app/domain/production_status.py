"""生产流程状态机。

一次“生产(Production)” = 一个主题从想法到可发布视频的完整过程。
LLM 一次生成全部内容（主题、台词、字幕、分镜），之后有三个强制人工审核点：
分镜（审核 A）、台词与字幕（审核 B）、成片（审核 C）。
"""
from enum import StrEnum


class ProductionStatus(StrEnum):
    SCENE_GENERATING = "scene_generating"  # LLM 生成内容中（主题/台词/字幕/分镜）
    SCENE_REVIEW = "scene_review"  # 【审核 A】分镜
    DIALOGUE_REVIEW = "dialogue_review"  # 【审核 B】台词与字幕
    QUEUED = "queued"  # 已建视频任务，等待提交（夜间模式会等到窗口）
    GENERATING = "generating"  # 已提交 AutoDL，生成中
    VIDEO_REVIEW = "video_review"  # 【审核 C】成片
    APPROVED = "approved"  # 待发布
    PUBLISHED = "published"
    FAILED = "failed"
    DISCARDED = "discarded"


S = ProductionStatus

REVIEW_STATUSES = frozenset({S.SCENE_REVIEW, S.DIALOGUE_REVIEW, S.VIDEO_REVIEW})
TERMINAL_STATUSES = frozenset({S.PUBLISHED, S.DISCARDED})

_ALLOWED: dict[S, frozenset[S]] = {
    S.SCENE_GENERATING: frozenset({S.SCENE_REVIEW, S.FAILED, S.DISCARDED}),
    S.SCENE_REVIEW: frozenset({S.DIALOGUE_REVIEW, S.SCENE_GENERATING, S.DISCARDED}),
    # 台词和分镜来自同一次生成，重新生成要整体重来，所以回到 SCENE_GENERATING；也可以退回审核 A
    S.DIALOGUE_REVIEW: frozenset({S.QUEUED, S.SCENE_GENERATING, S.SCENE_REVIEW, S.DISCARDED}),
    S.QUEUED: frozenset({S.GENERATING, S.VIDEO_REVIEW, S.FAILED, S.DISCARDED}),
    S.GENERATING: frozenset({S.VIDEO_REVIEW, S.FAILED, S.DISCARDED}),
    S.VIDEO_REVIEW: frozenset({S.APPROVED, S.QUEUED, S.DISCARDED}),
    S.APPROVED: frozenset({S.PUBLISHED, S.DISCARDED}),
    # 失败后重试：回到失败的那个阶段
    S.FAILED: frozenset({S.SCENE_GENERATING, S.QUEUED, S.DISCARDED}),
    S.PUBLISHED: frozenset(),
    S.DISCARDED: frozenset(),
}


def can_transition(src: S, dst: S) -> bool:
    return dst in _ALLOWED[src]


# 每个状态下前端可以展示的操作，由后端给出，避免前后端各写一份规则
ALLOWED_ACTIONS: dict[S, list[str]] = {
    S.SCENE_GENERATING: ["discard"],
    S.SCENE_REVIEW: ["approve_scene", "regenerate", "discard"],
    S.DIALOGUE_REVIEW: ["approve_dialogue", "regenerate", "back_to_scene", "discard"],
    S.QUEUED: ["discard"],
    S.GENERATING: ["discard"],
    S.VIDEO_REVIEW: ["approve_video", "regenerate_video", "discard"],
    S.APPROVED: ["mark_published", "discard"],
    S.FAILED: ["retry", "discard"],
    S.PUBLISHED: [],
    S.DISCARDED: [],
}
