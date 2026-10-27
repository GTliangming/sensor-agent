"""HITL（人工介入）主图：在每个关键创作步骤后插入人工审核闸门。

与 single_graph 复用同一批节点函数，区别在于：
- 分镜 / 素材 / 补图 / 配音 / 图生视频 / 字幕 后各插入一个 human_* 审核节点；
- compile 时用 interrupt_before 在这些 human 节点前暂停，等待人工 resume；
- 用 checkpointer（thread_id=task_id）保存暂停点的完整状态；生产由 task_service 传入
  AsyncSqliteSaver 做持久化，未传时退回进程内 MemorySaver（仅测试/脚本用）；
- graph_mode=multi 时，渲染后同样接质检 + Supervisor 受控返工。

人工在每个闸门可做 4 件事（由 task_service 注入到 state.review_action）：
- approve：通过，继续下一步；
- edit：直接改产物（task_service 先把编辑结果写回 state），再继续；
- regenerate：打回重做本步（可带 review_feedback，分镜会用它重生成）；
- cancel：取消（在 task_service 层处理，不回到图里）。

"""
from __future__ import annotations

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from app.config import Settings, get_settings
from app.graph.nodes import assets, media, persist, quality, validate
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

# human 节点名 -> 闸门标识；task_service 用它识别"停在哪个闸门"
GATE_BY_NODE: dict[str, str] = {
    "human_storyboard": "storyboard",
    "human_assets": "assets",
    "human_images": "images",
    "human_tts": "tts",
    "human_clips": "clips",
    "human_subtitles": "subtitles",
}
HUMAN_NODES: list[str] = list(GATE_BY_NODE)

# 闸门标识 -> 该闸门待审 / 可编辑的 state 字段
GATE_FIELD: dict[str, str] = {
    "storyboard": "storyboard",
    "assets": "asset_plan",
    "images": "asset_plan",
    "tts": "audio_plan",
    "clips": "scene_clips",
    "subtitles": "subtitle_path",
}

def _make_human(gate: str):
    """人工审核节点：无副作用，只把注入的 review_action 拷到 route_hint 供路由读取。"""
    async def _human(state: AgentState) -> dict:
        return {"route_hint": state.get("review_action") or "approve"}

    _human.__name__ = f"human_{gate}"
    return _human


def _review_route(state: AgentState) -> str:
    """审核路由：regenerate -> 回炉重做本步；其余（approve/edit）-> 继续下一步。"""
    return "regen" if state.get("route_hint") == "regenerate" else "next"



def build_hitl_graph(
    provider: TextProvider | None = None,
    settings: Settings | None = None,
    repo: TaskRepository | None = None,
    image_provider: ImageProvider | None = None,
    tts_provider: TTSProvider | None = None,
    video_provider: VideoProvider | None = None,
    video_disabled: bool = False,
    checkpointer: object | None = None,
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
    if settings.graph_mode == "multi":
        g.add_node("quality_check", quality.quality_check)
        g.add_node("supervisor", quality.make_supervisor(settings))
    for node_name, gate in GATE_BY_NODE.items():
        g.add_node(node_name, _make_human(gate))

    def _branch(src: str, nxt: str) -> None:
        g.add_conditional_edges(src, continue_or_fail, {"continue": nxt, "fail": "save_result"})

    def _gate(human_node: str, regen: str, nxt: str) -> None:
        g.add_conditional_edges(human_node, _review_route, {"regen": regen, "next": nxt})

    g.add_edge(START, "validate_request")
    _branch("validate_request", "generate_storyboard")
    _branch("generate_storyboard", "validate_storyboard")
    _branch("validate_storyboard", "human_storyboard")
    _gate("human_storyboard", "generate_storyboard", "retrieve_assets")

    g.add_edge("retrieve_assets", "plan_missing_assets")
    g.add_edge("plan_missing_assets", "human_assets")
    _gate("human_assets", "retrieve_assets", "generate_missing_images")

    g.add_edge("generate_missing_images", "human_images")
    _gate("human_images", "generate_missing_images", "synthesize_tts")

    _branch("synthesize_tts", "human_tts")
    _gate("human_tts", "synthesize_tts", "animate_scenes")

    _branch("animate_scenes", "human_clips")
    _gate("human_clips", "animate_scenes", "build_subtitles")

    _branch("build_subtitles", "human_subtitles")
    _gate("human_subtitles", "build_subtitles", "render_video")

    if settings.graph_mode == "multi":
        # 多 Agent + HITL：渲染后接质检与受控路由（返工回到分镜时会重新经过人工闸门）
        _branch("render_video", "quality_check")
        g.add_edge("quality_check", "supervisor")
        g.add_conditional_edges("supervisor", quality.route_from_supervisor, {
            "validate_output": "validate_output",
            "generate_storyboard": "generate_storyboard",
            "retrieve_assets": "retrieve_assets",
            "save_result": "save_result",
        })
    else:
        _branch("render_video", "validate_output")
    g.add_edge("validate_output", "save_result")
    g.add_edge("save_result", END)

    return g.compile(checkpointer=checkpointer or MemorySaver(), interrupt_before=HUMAN_NODES)

