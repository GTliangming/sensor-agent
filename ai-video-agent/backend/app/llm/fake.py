"""开发/测试用的假 LLM：返回固定结构的占位内容，不是真实创作结果。"""
from app.llm.base import LLMError


class FakeLLM:
    name = "fake"

    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []  # (system, user)，便于测试断言提示词内容
        self.fail_next: LLMError | None = None

    async def chat_json(self, system: str, user: str) -> dict:
        self.calls.append((system, user))
        if self.fail_next:
            err, self.fail_next = self.fail_next, None
            raise err
        if system.startswith("你是短视频选题策划"):
            return {"topic": "占位主题：停止内耗"}
        return {
            "theme": "占位主题",
            "tts_text": "（占位台词）今天也要好好爱自己。",
            "subtitles": [
                {"start": "00:00:00,000", "end": "00:00:05,000", "text": "第一句"},
                {"start": "00:00:05,000", "end": "00:00:10,000", "text": "第二句"},
                {"start": "00:00:10,000", "end": "00:00:15,000", "text": "第三句"},
            ],
            "scenes": [
                {"scene_id": i, "scene_desc": f"scene {i}", "action_desc": f"action {i}", "camera_desc": f"camera {i}"}
                for i in (1, 2, 3)
            ],
        }
