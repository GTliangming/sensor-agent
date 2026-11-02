"""日志配置：开发环境输出彩色可读文本，生产环境输出单行 JSON。

JSON 适合被采集，但人眼读起来全是引号和转义。因此按用途一分为二：
- ConsoleFormatter：`15:04:05.123 INFO   routes.agent  [1f3c9a2b] 工具调用完成 tool=search`
- JsonFormatter：单行 JSON，供容器/日志平台采集

两者共用同一套 `extra` 字段约定，切格式不会丢信息。
"""

import json
import logging
import os
import sys
from collections.abc import Iterator

from app.core.context import current_request_id

# 允许通过 logger.info("...", extra={...}) 带出来的业务字段
_EXTRA_FIELDS = (
    "module_name",
    "tool_name",
    "latency_ms",
    "rows",
    "error_code",
    "path",
    "method",
    "status_code",
)

# ANSI 颜色：只用于终端。重定向到文件或被采集时由 _supports_color 关闭
_RESET = "\033[0m"
_DIM = "\033[38;5;245m"  # 次要信息：时间、logger 名、附加字段
_ACCENT = "\033[38;5;81m"  # 强调信息：request_id
_LEVEL_COLORS = {
    "DEBUG": "\033[38;5;245m",
    "INFO": "\033[38;5;39m",
    "WARNING": "\033[38;5;214m",
    "ERROR": "\033[38;5;203m",
    "CRITICAL": "\033[1;97;41m",
}

_LEVEL_WIDTH = 8  # 最长级别 CRITICAL 刚好 8 个字符
_LOGGER_WIDTH = 24
_RID_WIDTH = 8  # request_id 只展示前 8 位，完整值去日志系统里查


def _iter_extras(record: logging.LogRecord) -> Iterator[tuple[str, object]]:
    """取出有值的业务附加字段。

    `None` 不输出——否则每行都拖着一串 `tool_name=None rows=None`，反而更难读。
    """
    for field in _EXTRA_FIELDS:
        value = getattr(record, field, None)
        if value is not None:
            yield field, value


def _render(value: object) -> str:
    """把字段值渲染成一行文本：含空格的字符串加引号，避免被误读成多个字段。"""
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False) if not value or " " in value else value
    return str(value)


def _short_logger(name: str) -> str:
    """`app.api.routes.agent` → `routes.agent`；仍超长时保留尾部，尾部信息量更大。"""
    parts = name.split(".")
    short = ".".join(parts[-2:]) if len(parts) > 2 else name
    if len(short) > _LOGGER_WIDTH:
        short = "…" + short[-(_LOGGER_WIDTH - 1) :]
    return short


def _indent(text: str, prefix: str = "    ") -> str:
    """把异常堆栈整体缩进，避免和上一行正文粘在一起。"""
    return "\n".join(prefix + line for line in text.splitlines())


def _supports_color(stream: object) -> bool:
    """NO_COLOR 优先（规范：有值即关闭），FORCE_COLOR 可强制打开，否则看是否终端。"""
    if os.environ.get("NO_COLOR"):
        return False
    if os.environ.get("FORCE_COLOR"):
        return True
    return bool(getattr(stream, "isatty", lambda: False)())


class ConsoleFormatter(logging.Formatter):
    """面向人的单行文本：`时间 级别 logger [request_id] 消息 key=value ...`。

    颜色只包裹内容本身、不参与补位（先补齐再上色），
    否则 ANSI 转义码会被算进宽度，列就对不齐了。
    """

    def __init__(self, color: bool = True) -> None:
        super().__init__()
        self.color = color

    def formatTime(self, record: logging.LogRecord, datefmt: str | None = None) -> str:
        # 精确到毫秒：排查 42.3ms 这类耗时，秒级时间戳分不出先后
        return f"{super().formatTime(record, '%H:%M:%S')}.{int(record.msecs):03d}"

    def _paint(self, text: str, color: str) -> str:
        return f"{color}{text}{_RESET}" if self.color else text

    def format(self, record: logging.LogRecord) -> str:
        level = self._paint(
            f"{record.levelname:<{_LEVEL_WIDTH}}",
            _LEVEL_COLORS.get(record.levelname, ""),
        )
        logger_name = self._paint(f"{_short_logger(record.name):<{_LOGGER_WIDTH}}", _DIM)

        head = [self._paint(self.formatTime(record), _DIM), level, logger_name]
        request_id = current_request_id()
        if request_id != "-":
            head.append(self._paint(f"[{request_id[:_RID_WIDTH]}]", _ACCENT))

        line = " ".join(head) + " " + record.getMessage()

        extras = [f"{field}={_render(value)}" for field, value in _iter_extras(record)]
        if extras:
            line += "  " + self._paint(" ".join(extras), _DIM)

        if record.exc_info:
            line += "\n" + _indent(self.formatException(record.exc_info))
        return line


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": current_request_id(),
        }
        for field, value in _iter_extras(record):
            payload[field] = value
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def setup_logging(level: str = "INFO", *, pretty: bool | None = None) -> None:
    """配置根 logger 与 uvicorn 日志。

    pretty=None 时自动选择：开发环境用彩色文本，其余用 JSON。
    显式传 pretty=False 可以在本地预览线上格式。
    """
    if pretty is None:
        # 延迟导入：日志初始化早于业务模块加载，也避免 config 与日志模块互相牵连
        from app.core.config import get_settings

        pretty = get_settings().is_dev

    handler = logging.StreamHandler(sys.stdout)
    if pretty:
        handler.setFormatter(ConsoleFormatter(color=_supports_color(sys.stdout)))
    else:
        handler.setFormatter(JsonFormatter())

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())

    # uvicorn 自带 handler 且不向 root 传播，这里统一换成同一种格式
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers = [handler]
        logger.propagate = False


# 脱敏约定从第一步就立住:Token / Cookie / 密码 / 音频地址 / 标注正文永远不进日志。
# 后面写工具时只记录 args_summary。
