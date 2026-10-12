from pydantic import BaseModel, field_validator


class ChatRequest(BaseModel):
    """/api/chat 的请求体契约。"""

    question: str

    @field_validator("question")
    @classmethod
    def not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("question 不能为空")
        return v
