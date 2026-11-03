"""DeepSeek Chat Completions 客户端。

设计要点：

- 上层只处理 `AppError`，不感知 httpx 或供应商响应格式；
- 只对可重试错误重试：429 / 5xx / 超时 / 连接失败；
- 日志只记录状态、耗时和重试原因，不记录 prompt、回答和 API Key。
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Sequence
from typing import Any

import httpx  # 异步 HTTP 客户端
from pydantic import ValidationError  # 响应结构校验失败时抛的异常

from app.core.config import get_settings
from app.core.error_catalog import ErrorCode
from app.core.errors import AppError
from app.integrations.llm.types import LLMMessage, LLMResult
from app.schemas.llm import DeepSeekChatResponse

logger = logging.getLogger(__name__)

# 可重试的 HTTP 状态码：429=限流，5xx=服务端临时故障。
# 用 frozenset：不可变 + 查找快（O(1)），适合当常量白名单。
_RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})


class DeepSeekClient:
    """异步 DeepSeek 客户端；一个实例复用一个连接池。"""

    def __init__(
        self,
        *,  # 星号：强制后面所有参数用关键字传（client(api_key=...)），避免位置传参搞混顺序
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        timeout_seconds: float | None = None,
        max_retries: int | None = None,
        backoff_seconds: float = 0.5,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        settings = get_settings()

        # 统一的「显式参数优先，否则回退配置」模式：
        # 传了就用传入值，没传（None）就取 .env/Settings 里的默认值。
        # 这样生产环境走配置，测试里又能单独覆盖某一项。
        self._api_key = settings.deepseek_api_key if api_key is None else api_key
        resolved_base_url = (
            settings.deepseek_base_url if base_url is None else base_url
        )
        self._base_url = resolved_base_url.rstrip("/")  # 去掉末尾斜杠，拼路径时不出现双斜杠
        self._model = settings.deepseek_model if model is None else model
        self._timeout = (
            settings.llm_timeout_seconds if timeout_seconds is None else timeout_seconds
        )
        self._max_retries = (
            settings.llm_max_retries if max_retries is None else max_retries
        )
        self._temperature = settings.llm_temperature  # 采样温度，默认走配置
        self._max_tokens = settings.llm_max_tokens  # 单次最大生成 token
        self._backoff_seconds = backoff_seconds  # 重试退避基数

        # 固定请求头；仅在有 key 时才带 Authorization，
        # 没配 key 也能构造实例（真正调用时在 chat() 里再报错）。
        headers = {"Accept": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        # 创建异步客户端：内部维护连接池，整个实例生命周期复用，避免每次请求重建连接。
        # transport 可注入：测试时传入 MockTransport 拦截请求，不打真实网络。
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=httpx.Timeout(self._timeout),
            headers=headers,
            transport=transport,
        )

    # ---- 异步上下文管理器：支持 `async with DeepSeekClient() as c:` 用法 ----
    async def __aenter__(self) -> DeepSeekClient:
        # 进入 with 块时调用，返回实例本身
        return self

    async def __aexit__(
        self,
        exc_type: object,
        exc: object,
        traceback: object,
    ) -> None:
        # 退出 with 块时调用（无论是否异常），负责关闭连接池
        await self.aclose()

    async def aclose(self) -> None:
        # 关闭底层连接池，释放连接资源
        await self._client.aclose()

    async def chat(
        self,
        messages: Sequence[LLMMessage],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> LLMResult:
        """发送一次非流式对话请求，返回统一结果。"""
        # 1) 前置校验：没配 key 直接报错（503=服务暂不可用），不白跑一趟网络
        if not self._api_key:
            raise AppError(
                ErrorCode.LLM_NOT_CONFIGURED,
                "未配置 DEEPSEEK_API_KEY，暂时无法调用模型",
                status_code=503,
            )
        # 空消息是调用方的编程错误，用 ValueError 而非 AppError（不该发给用户看）
        if not messages:
            raise ValueError("messages must not be empty")

        # 2) 组装 DeepSeek /chat/completions 的请求体。
        #    把内部 LLMMessage 列表转成 API 要的 {"role","content"} 字典列表。
        #    temperature/max_tokens：本次调用显式传了就用，否则用实例默认。
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [
                {"role": message.role, "content": message.content}
                for message in messages
            ],
            "temperature": self._temperature if temperature is None else temperature,
            "max_tokens": self._max_tokens if max_tokens is None else max_tokens,
            "stream": False,  # 非流式：一次性拿完整回答
        }

        # 3) 发请求并计时。perf_counter 是单调时钟，专门用来测耗时（不受系统改时间影响）
        started = time.perf_counter()
        response = await self._post_with_retry(payload)
        latency_ms = int((time.perf_counter() - started) * 1000)

        # 4) 解析响应 JSON；拿不到合法 JSON 说明上游出了问题（502=上游错误）
        try:
            body = response.json()
        except ValueError as exc:
            raise AppError(
                ErrorCode.LLM_UPSTREAM_ERROR,
                "模型服务返回了非 JSON 响应",
                status_code=502,
            ) from exc

        # 5) 用 Pydantic 模型校验响应结构，把「裸 dict」变成带类型的对象。
        #    结构不符（字段缺失/类型变化）同样当上游异常处理。
        try:
            parsed = DeepSeekChatResponse.model_validate(body)
        except ValidationError as exc:
            raise AppError(
                ErrorCode.LLM_UPSTREAM_ERROR,
                "模型服务响应结构异常",
                status_code=502,
            ) from exc

        # 6) 一连串「内容有效性」检查：没有 choices / 内容为空都视为异常，
        #    绝不把空结果当成功返回给上层。
        if not parsed.choices:
            raise AppError(
                ErrorCode.LLM_UPSTREAM_ERROR,
                "模型服务未返回任何回答",
                status_code=502,
            )

        content = (parsed.choices[0].message.content or "").strip()
        if not content:
            raise AppError(
                ErrorCode.LLM_UPSTREAM_ERROR,
                "模型服务返回了空回答",
                status_code=502,
            )

        # 7) 组装统一结果对象。usage 可能缺失，缺失时 token 记 0；
        #    model 优先用响应里的（可能是具体版本号），拿不到再回退本地配置。
        usage = parsed.usage
        return LLMResult(
            content=content,
            model=parsed.model or self._model,
            input_tokens=usage.prompt_tokens if usage else 0,
            output_tokens=usage.completion_tokens if usage else 0,
            latency_ms=latency_ms,
        )

    async def _post_with_retry(self, payload: dict[str, Any]) -> httpx.Response:
        # 循环最多跑 max_retries+1 次（第 0 次是首发，之后才是重试）。
        # attempt 从 0 开始计数，用来算退避时间和判断「还能不能再试」。
        for attempt in range(self._max_retries + 1):
            try:
                response = await self._client.post("/chat/completions", json=payload)
            except httpx.TimeoutException as exc:
                # 超时：还有重试次数就退避后重来，否则抛 504（可重试）
                if attempt < self._max_retries:
                    await self._sleep_before_retry(attempt, "timeout")
                    continue
                raise AppError(
                    ErrorCode.LLM_TIMEOUT,
                    "模型服务响应超时，请稍后重试",
                    status_code=504,
                    retryable=True,
                ) from exc
            except httpx.HTTPError as exc:
                # 其他连接层错误（DNS、连接被拒等）：同样重试或最终抛 502。
                # 注意 TimeoutException 也是 HTTPError 的子类，所以超时分支必须写在前面。
                if attempt < self._max_retries:
                    await self._sleep_before_retry(attempt, "connection_error")
                    continue
                raise AppError(
                    ErrorCode.LLM_UPSTREAM_ERROR,
                    "无法连接模型服务",
                    status_code=502,
                    retryable=True,
                ) from exc

            # 请求成功发出并拿到响应：若状态码可重试且还有次数，退避后重来
            if (
                response.status_code in _RETRYABLE_STATUS
                and attempt < self._max_retries
            ):
                await self._sleep_before_retry(
                    attempt,
                    f"http_{response.status_code}",
                )
                continue

            # 到这里要么状态码正常，要么重试已用尽：交给 _raise_for_status 判定，
            # 没问题就返回响应（循环正常出口）。
            self._raise_for_status(response)
            return response

        # 正常流程不会走到这里；兜底避免类型检查报「缺少返回值」。
        raise AppError(
            ErrorCode.LLM_UPSTREAM_ERROR,
            "模型服务调用失败",
            status_code=502,
            retryable=True,
        )

    async def _sleep_before_retry(self, attempt: int, reason: str) -> None:
        # 指数退避：第 1 次等 backoff*1，第 2 次 backoff*2，第 3 次 backoff*4……
        # 给上游恢复时间，也避免雪崩式重试。
        delay = self._backoff_seconds * (2**attempt)
        # 只记重试原因/次数/等待时长，绝不记 prompt、回答或 API Key
        logger.warning(
            "llm request retry reason=%s attempt=%s delay_ms=%s",
            reason,
            attempt + 1,
            int(delay * 1000),
            extra={"module_name": "llm"},
        )
        if delay > 0:
            await asyncio.sleep(delay)  # 异步等待，不阻塞事件循环

    @staticmethod
    def _raise_for_status(response: httpx.Response) -> None:
        # 把 HTTP 状态码映射成项目统一的 AppError；状态码 → 错误码/文案一一对应。
        status = response.status_code
        if status < 400:
            return  # 2xx/3xx 视为成功，直接返回不抛错

        if status == 429:
            # 限流：可重试（但走到这说明重试已用尽）
            raise AppError(
                ErrorCode.LLM_RATE_LIMITED,
                "模型服务限流，请稍后重试",
                status_code=429,
                retryable=True,
            )
        if status in (401, 403):
            # 认证/权限问题：重试也没用，当成「未正确配置」让用户去查 key
            raise AppError(
                ErrorCode.LLM_NOT_CONFIGURED,
                "模型服务认证失败，请检查 DEEPSEEK_API_KEY",
                status_code=503,
            )
        # 其余 4xx/5xx：统一归为上游错误；是否可重试取决于它在不在可重试白名单里
        raise AppError(
            ErrorCode.LLM_UPSTREAM_ERROR,
            f"模型服务返回异常（HTTP {status}）",
            status_code=502,
            retryable=status in _RETRYABLE_STATUS,
        )
