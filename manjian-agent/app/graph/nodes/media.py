"""配音 / 图生视频 / 字幕 / 渲染节点（文档 08 + 视频生成升级）。

链路：synthesize_tts -> animate_scenes -> build_subtitles -> render_video。
- audio_source=tts 或模型无音轨：走 TTS，视频裁到旁白时长并挂我们的音频；
- audio_source=video 且模型产出音轨：跳过 TTS，用视频自带音轨。
- video_gen=none：不生成视频，render 退回"图片 + Ken Burns"路径。
任一步失败置 status=failed，由主图 continue/fail 分支短路到 save_result。
"""
from __future__ import annotations

import asyncio

from app.config import Settings
from app.domain.plans import AudioPlan
from app.domain.storyboard import Storyboard
from app.graph.state import AgentState, Stage, TaskStatus
from app.observability.logging import get_logger
from app.services.media.render_service import RenderService
from app.services.media.subtitle_service import build_srt
from app.services.media.tts_service import TTSService
from app.services.media.video_service import VideoClipService

logger = get_logger(__name__)


def make_synthesize_tts(service: TTSService, use_tts: bool):
    async def synthesize_tts(state: AgentState) -> dict:
        if state.get("status") == TaskStatus.FAILED or not use_tts:
            return {}
        storyboard = Storyboard.model_validate(state["storyboard"])
        try:
            plan = await service.synthesize(storyboard, state["task_id"])
        except Exception as exc:  # noqa: BLE001
            logger.warning("tts 失败 task=%s: %s", state["task_id"], exc)
            return {"stage": Stage.TTS, "status": TaskStatus.FAILED,
                    "errors": [{"code": "tts_error", "message": str(exc)}]}
        return {"stage": Stage.TTS, "audio_plan": plan.model_dump()}

    return synthesize_tts


def make_animate_scenes(service: VideoClipService | None, use_tts: bool):
    async def animate_scenes(state: AgentState) -> dict:
        if state.get("status") == TaskStatus.FAILED or service is None:
            return {}
        storyboard = Storyboard.model_validate(state["storyboard"])
        audio_plan = AudioPlan.model_validate(state["audio_plan"]) if state.get("audio_plan") else None
        try:
            clips = await service.build(state["task_id"], storyboard, state["asset_plan"],
                                        audio_plan, use_tts)
        except Exception as exc:  # noqa: BLE001
            logger.warning("图生视频失败 task=%s: %s", state["task_id"], exc)
            return {"stage": Stage.ANIMATING, "status": TaskStatus.FAILED,
                    "errors": [{"code": "video_gen_error", "message": str(exc)}]}
        return {"stage": Stage.ANIMATING, "scene_clips": clips}

    return animate_scenes


def make_build_subtitles(settings: Settings):
    async def build_subtitles(state: AgentState) -> dict:
        if state.get("status") == TaskStatus.FAILED:
            return {}
        srt = settings.tasks_dir / state["task_id"] / "subtitles.srt"
        try:
            audio_plan = _subtitle_source(state)
            build_srt(audio_plan, srt, settings.transition_seconds)
        except Exception as exc:  # noqa: BLE001
            logger.warning("字幕生成失败 task=%s: %s", state["task_id"], exc)
            return {"stage": Stage.SUBTITLES, "status": TaskStatus.FAILED,
                    "errors": [{"code": "subtitle_error", "message": str(exc)}]}
        return {"stage": Stage.SUBTITLES, "subtitle_path": str(srt)}

    return build_subtitles


def _subtitle_source(state: AgentState) -> AudioPlan:
    """字幕时序来源：优先 TTS 的 audio_plan；否则用视频片段时长 + 分镜旁白。"""
    if state.get("audio_plan"):
        return AudioPlan.model_validate(state["audio_plan"])
    storyboard = Storyboard.model_validate(state["storyboard"])
    text_by_scene = {s.scene_id: s.narration for s in storyboard.scenes}
    segments = [
        {"scene_id": c["scene_id"], "order": c["order"],
         "text": text_by_scene.get(c["scene_id"], ""), "duration_seconds": c["duration"]}
        for c in state.get("scene_clips", [])
    ]
    return AudioPlan(task_id=state["task_id"], producer="clips", segments=segments)


def make_render_video(service: RenderService):
    async def render_video(state: AgentState) -> dict:
        if state.get("status") == TaskStatus.FAILED:
            return {}
        storyboard = Storyboard.model_validate(state["storyboard"])
        subtitle_path = state.get("subtitle_path", "")
        try:
            if state.get("scene_clips"):
                plan = await asyncio.to_thread(
                    service.render_from_clips, state["task_id"], state["scene_clips"], subtitle_path)
            else:
                audio_plan = AudioPlan.model_validate(state["audio_plan"])
                plan = await asyncio.to_thread(
                    service.render, state["task_id"], storyboard,
                    state["asset_plan"], audio_plan, subtitle_path)
        except Exception as exc:  # noqa: BLE001
            logger.warning("渲染失败 task=%s: %s", state["task_id"], exc)
            return {"stage": Stage.RENDERING, "status": TaskStatus.FAILED,
                    "errors": [{"code": "render_error", "message": str(exc)}]}
        logger.info("渲染完成 task=%s output=%s validated=%s",
                    state["task_id"], plan.output_path, plan.validated)
        return {"stage": Stage.RENDERING, "render_plan": plan.model_dump()}

    return render_video
