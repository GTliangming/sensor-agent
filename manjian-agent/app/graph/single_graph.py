"""单 Agent 主图（文档 03.1 主流程 + 图生视频升级）。

链路：请求校验 -> 分镜 -> 素材检索 -> 缺口规划 -> AI 补图 -> 配音 -> 图生视频 -> 字幕 -> 渲染 -> 校验 -> 定稿。
- video_gen=none：跳过图生视频，渲染退回"图片 + Ken Burns 运镜"。
- audio_source + 模型是否产出音轨 共同决定走 TTS 还是用视频自带音轨。
失败节点经 continue/fail 分支短路到 save_result。
"""
from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from app.config import Settings, get_settings
from app.graph.nodes import assets, media, persist, validate
from app.graph.nodes.storyboard import make_generate_storyboard
from app.graph.routing import continue_or_fail
from app.graph.state import AgentState
from app.providers.image.base import ImageProvider
from app.providers.image.factory import get_image_provider
from app.providers.text.base import TextProvider
from app.providers.text.factory import get_text_provider
from app.providers.tts.base import TTSProvider
from app.providers.tts.factory import get_tts_provider
from app.providers.video.base import VideoProvider
from app.providers.video.factory import get_video_provider
from app.repositories.sqlite import TaskRepository
from app.services.assets.image_generation import ImageGenerationService
from app.services.media.render_service import RenderService
from app.services.media.tts_service import TTSService
from app.services.media.video_service import VideoClipService


def build_single_graph(
    provider: TextProvider | None = None,
    settings: Settings | None = None,
    repo: TaskRepository | None = None,
    image_provider: ImageProvider | None = None,
    tts_provider: TTSProvider | None = None,
    video_provider: VideoProvider | None = None,
    video_disabled: bool = False,
):
    settings = settings or get_settings()
    provider = provider or get_text_provider(settings)
    repo = repo or TaskRepository(settings.db_file)
    image_provider = image_provider or get_image_provider(settings)
    tts_provider = tts_provider or get_tts_provider(settings)
    if video_provider is None and not video_disabled:
        video_provider = get_video_provider(settings)

    produces_audio = bool(video_provider and video_provider.produces_audio)
    video_active = video_provider is not None
    # 能从视频拿到音轨才用视频音轨，否则一律回退到我们自己的 TTS
    use_tts = (settings.audio_source == "tts") or (not video_active) or (not produces_audio)

    image_service = ImageGenerationService(image_provider, repo, settings)
    tts_service = TTSService(tts_provider, settings, repo)
    video_service = VideoClipService(video_provider, repo, settings) if video_active else None
    render_service = RenderService(repo, settings)

    g = StateGraph(AgentState)
    g.add_node("validate_request", validate.validate_request)
    g.add_node("generate_storyboard", make_generate_storyboard(provider, settings, repo))
    g.add_node("validate_storyboard", validate.validate_storyboard)
    g.add_node("retrieve_assets", assets.make_retrieve_assets(repo))
    g.add_node("plan_missing_assets", assets.plan_missing_assets)
    g.add_node("generate_missing_images", assets.make_generate_missing_images(image_service))
    g.add_node("synthesize_tts", media.make_synthesize_tts(tts_service, use_tts))
    g.add_node("animate_scenes", media.make_animate_scenes(video_service, use_tts))
    g.add_node("build_subtitles", media.make_build_subtitles(settings))
    g.add_node("render_video", media.make_render_video(render_service))
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
    _branch("render_video", "validate_output")

    g.add_edge("validate_output", "save_result")
    g.add_edge("save_result", END)

    return g.compile()
