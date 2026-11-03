from dataclasses import dataclass


@dataclass(frozen=True)
class LLMMessage:
    role: str      # system / user / assistant
    content: str


@dataclass(frozen=True)
class LLMResult:
    content: str
    model: str
    input_tokens: int
    output_tokens: int
    latency_ms: int