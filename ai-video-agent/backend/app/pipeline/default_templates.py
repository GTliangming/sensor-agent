"""模板种类与“起步文本”。

提示词不写在代码里：每个业务线下的每种账号类型，把下面这些模板存在数据库（prompt_templates），
在页面「提示词模板」里修改；生成时按账号类型查库，缺哪份就明确报错，不会悄悄用代码里的默认值。
这里的文本只用于编辑器的“以内置默认为起点”，以及给新账号类型做参考，运行时不会读取。

一次生产用到的模板：
- content          发给 LLM 的系统提示：一次生成主题、台词、字幕、分镜（输出 JSON）
- content_user     发给 LLM 的用户消息（带本次主题、时长、修改意见）
- topic_suggest    “AI 想一个主题”用的系统提示
- video_base       视频提示词的全局前缀
- video_character  固定角色设定（可以不建）
- video_shot       每个镜头的写法，按镜头数重复
- video_dialogue   台词怎么写进视频提示词（H3 工作流没有单独的台词参数，台词只能写在 prompt 里）
- video_negative   负向提示词本身（要发送：配置了负向字段就单独传，否则用「负向写法」拼进 prompt）
- video_negative_line 负向提示词怎么写进视频提示词（H3 工作流只有一个 prompt 字段，负向只能拼进去）
视频提示词 = video_base + video_character + 各镜头（video_shot 渲染后用空格连接）+ 台词（video_dialogue）
            + 负向（video_negative_line），最后一并作为 prompt 发送，见 pipeline/assemble.py 与 TemplateService.with_negative。
"""

KIND_LABELS = {
    "content": "内容生成（系统提示）",
    "content_user": "内容生成（用户消息）",
    "topic_suggest": "AI 想主题",
    "video_base": "视频提示词前缀",
    "video_character": "角色设定",
    "video_shot": "镜头写法",
    "video_dialogue": "台词写法",
    "video_negative": "负向提示词",
    "video_negative_line": "负向写法",
}

# 缺了就不能生成的模板；其余可以不建（相当于空）
REQUIRED_KINDS = ["content", "content_user", "video_base", "video_shot"]
OPTIONAL_KINDS = ["video_character", "video_dialogue", "video_negative", "video_negative_line", "topic_suggest"]
ALL_KINDS = list(KIND_LABELS)

STARTER_BODIES = {
    "content": """你是一个短视频自动化编导，负责策划主题并生成带台词、字幕和分镜的业务 JSON 数据。

严格按照“起、承、转”生成 3 个镜头的短视频数据，直接输出纯 JSON（不要包含 ```json 标记）：
{
  "theme": "主题名称（中文）",
  "tts_text": "中文台词，语速自然，温暖真诚",
  "subtitles": [
    {"start": "00:00:00,000", "end": "00:00:05,000", "text": "第一句"},
    {"start": "00:00:05,000", "end": "00:00:10,000", "text": "第二句"},
    {"start": "00:00:10,000", "end": "00:00:15,000", "text": "第三句"}
  ],
  "scenes": [
    {"scene_id": 1, "scene_desc": "英文短语", "action_desc": "英文短语", "camera_desc": "英文短语"},
    {"scene_id": 2, "scene_desc": "英文短语", "action_desc": "英文短语", "camera_desc": "英文短语"},
    {"scene_id": 3, "scene_desc": "英文短语", "action_desc": "英文短语", "camera_desc": "英文短语"}
  ]
}

底线：scenes 里的描述必须是纯英文短语；不出现负面、对立内容。""",
    "content_user": """请开始生成，只输出 JSON。

【本次主题】{{topic}}
（主题为空：按系统提示的要求，自己随机选一个。主题不为空：以它为准。）
【视频时长】{{duration_seconds}} 秒。系统提示里的示例按 15 秒设计，请按时长等比例调整台词字数（每秒约 3.5 个字）和字幕时间轴，镜头数量保持不变。

{{revision_notes}}""",
    "topic_suggest": """你是短视频选题策划。只输出一个 JSON 对象，不要输出其他文字。格式：{"topic": "微主题"}

账号人设：{{persona}}
画面风格：{{style_guide}}
请随机想一个新的微主题（中文，12 字以内）。
最近用过的主题，不要重复：{{recent_topics}}""",
    "video_base": "(masterpiece, best quality:1.2), strict {{aspect_ratio}} aspect ratio, cinematic lighting, no text, no watermark, ",
    "video_character": "",
    "video_shot": "Shot {{shot_index}} ({{start}}-{{end}}s): {{scene_desc}} {{action_desc}} {{camera_desc}}",
    "video_dialogue": "The character says in Mandarin Chinese: \"{{tts_text}}\"",
    "video_negative_line": "Negative prompt (avoid all of these): {{negative_prompt}}",
    "video_negative": "(worst quality, low quality:1.4), text, watermark, subtitles, distorted face, extra limbs, bad anatomy, deformed hands, shaky camera.",
}
