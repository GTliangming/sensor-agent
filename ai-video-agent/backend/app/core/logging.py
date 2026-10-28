"""日志配置与敏感信息脱敏。"""
import logging
import re

# 把常见的凭证形式替换掉，避免 Token 进入日志或错误信息
_SECRET_PATTERNS = [
    re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._\-]+"),
    re.compile(r"(?i)((?:token|api[_-]?key|password|secret)[\"'=:\s]+)[^\s\"',;]+"),
]


def redact(text: str, extra_secrets: list[str] | None = None) -> str:
    """脱敏字符串。extra_secrets 用于精确替换已知的密钥原文。"""
    for secret in extra_secrets or []:
        if secret:
            text = text.replace(secret, "***")
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub(r"\1***", text)
    return text


def setup_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        level=level.upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    # httpx 默认会在 INFO 打印完整 URL，降噪
    logging.getLogger("httpx").setLevel(logging.WARNING)


def task_log(task_id: str, event: str, **fields: object) -> str:
    """生成 `task_id=xxx event=yyy k=v` 形式的日志文本，字段含义见部署文档第 15 节。"""
    parts = [f"task_id={task_id}", f"event={event}"]
    parts += [f"{k}={v}" for k, v in fields.items() if v is not None]
    return " ".join(parts)
