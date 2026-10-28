"""LLM 抽象：节点只依赖 chat_json，不关心具体模型。"""
from typing import Protocol


class LLMError(Exception):
    def __init__(self, code: str, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.code, self.message, self.retryable = code, message, retryable


class LLMClient(Protocol):
    name: str

    async def chat_json(self, system: str, user: str) -> dict:
        """调用模型并返回解析后的 JSON 对象；格式不合法时抛 LLMError。"""
        ...
