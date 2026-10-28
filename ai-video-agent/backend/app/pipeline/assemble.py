"""把已审核的业务数据拼成传给视频模型的最终提示词。

公式：video_base + video_character + 各镜头（video_shot 逐个渲染，空格连接）+ 台词（video_dialogue）。
所有模板都从数据库按“业务线 + 账号类型”查出来后传进来；这里只负责拼，不含任何文案。
时长平均分给各镜头并写成时间段，帮助模型按顺序展开。
"""
from app.pipeline.render import render


def assemble_video_prompt(
    base: str, character: str, shot: str, content: dict, *, duration: int, aspect_ratio: str,
    dialogue_line: str = "",
) -> str:
    common = {"aspect_ratio": aspect_ratio, "duration_seconds": str(duration)}
    scenes = content["scenes"]
    step = duration / len(scenes)
    shots = []
    for i, sc in enumerate(scenes):
        shots.append(render(shot, {
            **common, "shot_index": str(i + 1), "start": str(round(i * step)),
            "end": str(duration if i == len(scenes) - 1 else round((i + 1) * step)),
            "scene_desc": sc["scene_desc"], "action_desc": sc["action_desc"], "camera_desc": sc["camera_desc"],
        }))
    parts = [render(base, common) + render(character, common) + " ".join(shots)]
    if dialogue_line.strip():
        parts.append(render(dialogue_line, {**common, "tts_text": content["tts_text"]}))
    return " ".join(p for p in parts if p.strip()).strip()
