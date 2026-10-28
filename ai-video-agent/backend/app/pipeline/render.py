"""提示词模板渲染：{{变量}} 占位符。

不用 str.format，是因为模板里常有 JSON 示例的花括号；也不允许未知变量，避免拼写错误静默变成空串。
"""
import re

# 模板里允许使用的变量。新增变量时在这里登记，并在调用 render 的地方提供取值。
VARIABLES: dict[str, str] = {
    "account_name": "账号类型名称",
    "persona": "账号人设/语气",
    "style_guide": "账号画面风格与禁忌",
    "topic": "本次主题（可能为空，由 AI 自选）",
    "duration_seconds": "目标时长（秒）",
    "aspect_ratio": "画幅比例，如 9:16",
    "revision_notes": "上一版与修改意见（带意见重新生成时自动填充，首次为空）",
    "tts_text": "已审核的台词（仅台词写法）",
    "negative_prompt": "负向提示词（仅负向写法）",
    "recent_topics": "最近用过的主题（AI 想主题时用，避免重复）",
    "shot_index": "镜头序号，从 1 开始（仅镜头写法）",
    "start": "镜头开始秒数（仅镜头写法）",
    "end": "镜头结束秒数（仅镜头写法）",
    "scene_desc": "镜头的场景描述（仅镜头写法）",
    "action_desc": "镜头的动作描述（仅镜头写法）",
    "camera_desc": "镜头的运镜描述（仅镜头写法）",
}

_PATTERN = re.compile(r"\{\{\s*(\w+)\s*\}\}")


def find_variables(body: str) -> set[str]:
    return set(_PATTERN.findall(body))


def unknown_variables(body: str) -> list[str]:
    return sorted(find_variables(body) - VARIABLES.keys())


def render(body: str, values: dict[str, str]) -> str:
    return _PATTERN.sub(lambda m: values.get(m.group(1), ""), body)
