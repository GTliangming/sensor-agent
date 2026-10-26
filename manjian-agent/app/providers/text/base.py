"""文本 provider 协议与共享提示词构建。

provider 只负责调用模型拿到"原始分镜 JSON（dict）"，是否合法由节点做 Pydantic 校验与重试。
这样 provider 可替换（DeepSeek / 其他供应商 / 本地桩），不与业务编排耦合。
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable

from app.domain.request import CreateTaskRequest

# 分镜 JSON 的 schema 说明，拼进提示词，提升结构遵循率。
STORYBOARD_SCHEMA_HINT = """\
只输出一个 JSON 对象，不要任何多余文字或 markdown 代码块，结构如下：
{
  "title": "字符串，视频标题",
  "hook": "字符串，开场钩子",
  "closing_line": "字符串，结尾金句",
  "scenes": [
    {
      "scene_id": "字符串，场景唯一 id，如 scene_01",
      "order": 1,
      "narration": "字符串，这一镜的旁白（<=500 字）",
      "visual_prompt": "字符串，这一镜的画面提示词（<=1000 字）",
      "duration_seconds": 2.5,
      "mood": "字符串，情绪，如 warm / calm / excited",
      "tags": ["关键词1", "关键词2"],
      "needs_character_consistency": true
    }
  ]
}
要求：order 从 1 连续递增；scene_id 唯一；所有 scenes 的 duration_seconds 总和尽量接近目标时长。"""


def build_storyboard_prompt(request: CreateTaskRequest, feedback: str | None = None) -> tuple[str, str]:
    """返回 (system, user) 提示词。feedback 为人工返工时的修改意见，会拼进提示词。"""
    system = (
        "你是资深短视频分镜编剧，擅长把一个主题拆成节奏紧凑的竖屏分镜。"
        "你只输出结构化 JSON，不输出解释。"
    )
    user = (
        f"主题：{request.topic}\n"
        f"风格：{request.style}\n"
        f"目标时长：约 {request.target_seconds} 秒\n"
        f"语言：{request.language}\n"
        f"最大镜头数：{request.max_scenes}\n\n"
    )
    if feedback:
        user += f"【人工修改意见，请据此调整分镜】：{feedback}\n\n"
    user += STORYBOARD_SCHEMA_HINT
    return system, user


@runtime_checkable
class TextProvider(Protocol):
    name: str

    async def generate_storyboard(
        self, request: CreateTaskRequest, *, attempt: int = 1, feedback: str | None = None
    ) -> dict:
        """返回原始分镜 dict；合法性由调用方校验。

        attempt 用于让 provider 在重试时调整策略；feedback 为人工返工意见（可空）。
        """
        ...
