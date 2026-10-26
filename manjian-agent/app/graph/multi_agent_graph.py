"""多 Agent 主图（文档 04/05，阶段 6）。

在单图链路末尾加入 Quality Agent + Supervisor 的"有限返工"闭环：
  ... render_video -> quality_check -> supervisor -> {CONTINUE|REVISE_STORYBOARD|RETRY_ASSET_SEARCH|FAIL}
- Supervisor 只返回受控枚举；非法决策被拒绝为 FAIL（见 routing/quality）。
- 返工有次数上限（max_storyboard_revisions / max_asset_rechecks），不会无限循环。
- 不绕过授权/预算/状态：这些仍由前序确定性节点与代码强制。
与单图共用全部节点，只多了质检与路由，便于对照"拆分前后"的收益。
"""
from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from app.config import Settings, get_settings
from app.graph.nodes import assets, media, persist, quality, validate
from app.graph.nodes.storyboard import make_generate_storyboard
from app.graph.routing import continue_or_fail
from app.graph.state import AgentState
from app.providers.image.factory import get_image_provider
from app.providers.text.factory import get_text_provider
from app.providers.tts.factory import get_tts_provider
from app.providers.video.factory import get_video_provider
from app.repositories.sqlite import TaskRepository
from app.services.assets.image_generation import ImageGenerationService
from app.services.media.render_service import RenderService
from app.services.media.tts_service import TTSService
from app.services.media.video_service import VideoClipService


def build_multi_agent_graph(settings: Settings | None = None, repo: TaskRepository | None = None):
    settings = settings or get_settings()
    repo = repo or TaskRepository(settings.db_file)
    text_provider = get_text_provider(settings)
    image_provider = get_image_provider(settings)
    tts_provider = get_tts_provider(settings)
    video_provider = get_video_provider(settings)

    produces_audio = bool(video_provider and video_provider.produces_audio)
    video_active = video_provider is not None
    use_tts = (settings.audio_source == "tts") or (not video_active) or (not produces_audio)

    image_service = ImageGenerationService(image_provider, repo, settings)
    tts_service = TTSService(tts_provider, settings, repo)
    video_service = VideoClipService(video_provider, repo, settings) if video_active else None
    render_service = RenderService(repo, settings)

    g = StateGraph(AgentState)
    g.add_node("validate_request", validate.validate_request)
    g.add_node("generate_storyboard", make_generate_storyboard(text_provider, settings, repo))
    g.add_node("validate_storyboard", validate.validate_storyboard)
    g.add_node("retrieve_assets", assets.make_retrieve_assets(repo))
    g.add_node("plan_missing_assets", assets.plan_missing_assets)
    g.add_node("generate_missing_images", assets.make_generate_missing_images(image_service))
    g.add_node("synthesize_tts", media.make_synthesize_tts(tts_service, use_tts))
    g.add_node("animate_scenes", media.make_animate_scenes(video_service, use_tts))
    g.add_node("build_subtitles", media.make_build_subtitles(settings))
    g.add_node("render_video", media.make_render_video(render_service))
    g.add_node("quality_check", quality.quality_check)
    g.add_node("supervisor", quality.make_supervisor(settings))
    g.add_node("validate_output", validate.validate_output)
    g.add_node("save_result", persist.save_result)

    g.add_edge(START, "validate_request")

    def _branch(src: str, nxt: str) -> None:
        g.add_conditional_edges(src, continue_or_fail, {"continue": nxt, "fail": "save_result"})

    _branch("validate_request", "generate_storyboard")
    _branch("generate_storyboard", "validate_storyboard")
    _branch("validate_storyboard", "retrieve_assets")
    g.add_edge("retrieve_assets", "plan_missing_assets")
    g.add_edge("plan_missing_assets", "generate_missing_images")
    g.add_edge("generate_missing_images", "synthesize_tts")
    _branch("synthesize_tts", "animate_scenes")
    _branch("animate_scenes", "build_subtitles")
    _branch("build_subtitles", "render_video")
    _branch("render_video", "quality_check")

    # 质检 -> Supervisor -> 受控路由（含有限返工）
    g.add_edge("quality_check", "supervisor")
    g.add_conditional_edges("supervisor", quality.route_from_supervisor, {
        "validate_output": "validate_output",
        "generate_storyboard": "generate_storyboard",
        "retrieve_assets": "retrieve_assets",
        "save_result": "save_result",
    })
    g.add_edge("validate_output", "save_result")
    g.add_edge("save_result", END)

    return g.compile()
