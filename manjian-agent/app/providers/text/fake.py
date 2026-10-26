"""本地确定性文本 provider。

无需网络与密钥，给定相同输入产生相同分镜，用于：
- 本地开发（没有配置 DEEPSEEK_API_KEY 时自动启用）；
- 单元 / 集成测试（结果可预测）。
它不调用任何大模型，只做模板化拆镜。
"""
from __future__ import annotations

from app.domain.request import CreateTaskRequest


class FakeTextProvider:
    name = "fake"

    async def generate_storyboard(
        self, request: CreateTaskRequest, *, attempt: int = 1, feedback: str | None = None
    ) -> dict:
        # 目标镜头数：在 [3, max_scenes] 内按目标时长估算，每镜约 3 秒
        est = max(3, min(request.max_scenes, round(request.target_seconds / 3) or 3))
        per = round(request.target_seconds / est, 2)
        # 保证单镜时长在 (0, 15] 内
        per = min(per, 15.0) if per > 0 else 1.0

        beats = [
            ("开场点题", "warm"),
            ("展开细节", "calm"),
            ("情绪推进", "excited"),
            ("高光时刻", "excited"),
            ("温柔收束", "warm"),
        ]
        scenes = []
        for i in range(est):
            beat, mood = beats[i % len(beats)]
            scenes.append(
                {
                    "scene_id": f"scene_{i + 1:02d}",
                    "order": i + 1,
                    "narration": f"{request.topic} · {beat}：用{request.style}的笔触讲好这一段。",
                    "visual_prompt": (
                        f"{request.topic}，{beat}，{request.style}风格，竖屏构图，"
                        f"柔和光线，干净背景，无水印无文字"
                    ),
                    "duration_seconds": per,
                    "mood": mood,
                    "tags": [request.topic[:12], beat],
                    "needs_character_consistency": True,
                }
            )

        return {
            "title": f"{request.topic}（{request.style}）",
            "hook": f"关于「{request.topic}」，你可能忽略了这一点。",
            "closing_line": "点个关注，下一条继续。",
            "scenes": scenes,
        }
