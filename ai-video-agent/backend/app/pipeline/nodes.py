"""流水线节点：单次 LLM 调用，输入输出固定，便于测试和审核。

编排（什么时候调用哪个节点、什么时候停下等人审核）在 workers/pipeline_worker.py。
"""
import json
from dataclasses import dataclass

from app.llm.base import LLMClient, LLMError


@dataclass
class NodeResult:
    content: dict
    rendered_prompt: str  # 实际发给 LLM 的内容（系统提示 + 用户消息），存档用于排查


def build_revision_notes(previous: dict | None, feedback: str | None) -> str:
    """重新生成时，把上一版和用户意见交给模型，让它在原稿上改而不是另起炉灶。

    这是纯机制性的拼接（不是业务文案）；它的结果通过模板变量 {{revision_notes}} 放进 content_user 模板。
    """
    if not feedback:
        return ""
    prev = json.dumps(previous, ensure_ascii=False) if previous else "（无）"
    return f"【上一版】\n{prev}\n\n【修改意见】\n{feedback}\n\n请在上一版基础上按修改意见调整，仍然只输出完整的 JSON。"


def _str(value: object, field: str, *, required: bool = True) -> str:
    text = value.strip() if isinstance(value, str) else ""
    if required and not text:
        raise LLMError("LLM_BAD_OUTPUT", f"模型输出缺少字段 {field}", retryable=True)
    return text


def normalize_content(raw: dict) -> dict:
    """校验并规整 LLM 输出；缺字段按可重试的坏输出处理。"""
    subtitles = raw.get("subtitles")
    scenes = raw.get("scenes")
    if not isinstance(subtitles, list) or not subtitles:
        raise LLMError("LLM_BAD_OUTPUT", "模型输出缺少 subtitles", retryable=True)
    if not isinstance(scenes, list) or not scenes:
        raise LLMError("LLM_BAD_OUTPUT", "模型输出缺少 scenes", retryable=True)
    return {
        "theme": _str(raw.get("theme"), "theme", required=False),
        "tts_text": _str(raw.get("tts_text"), "tts_text"),
        "subtitles": [
            {"start": _str(s.get("start"), "start", required=False), "end": _str(s.get("end"), "end", required=False),
             "text": _str(s.get("text"), "subtitle.text")}
            for s in subtitles if isinstance(s, dict)
        ],
        "scenes": [
            {"scene_id": i + 1, "scene_desc": _str(s.get("scene_desc"), "scene_desc"),
             "action_desc": _str(s.get("action_desc"), "action_desc"), "camera_desc": _str(s.get("camera_desc"), "camera_desc")}
            for i, s in enumerate(scenes) if isinstance(s, dict)
        ],
    }


async def generate_content(llm: LLMClient, system_template: str, user_message: str) -> NodeResult:
    raw = await llm.chat_json(system_template, user_message)
    return NodeResult(normalize_content(raw), f"{system_template}\n\n---\n\n{user_message}")


async def suggest_topic(llm: LLMClient, system: str) -> str:
    """system 是渲染后的 topic_suggest 模板；用户消息只是触发词，内容都在模板里。"""
    raw = await llm.chat_json(system, "请开始，只输出 JSON。")
    return _str(raw.get("topic"), "topic")
