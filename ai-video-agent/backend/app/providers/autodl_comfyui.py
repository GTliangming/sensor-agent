"""AutoDL.Art ComfyUI Provider。

接口：
- 创建任务  POST /api/v1/comfyui/comfyui_workflow/{workflow_id}   body 为工作流自己的参数
            返回 {"code":"Success","data":{"task_id","status":"QUEUED",...}}
- 查询结果  GET  /api/v1/comfyui/comfyui_workflow/result/{task_id}   无请求参数
            返回 {"code":"Success","data":{"task_id","status","duration","results":[...]}}
- 认证：请求头 Authorization 直接放 Token（不带 Bearer）。
- 状态：QUEUED / RUNNING / SUCCESS / FAILED。

H3 参考生视频工作流的请求体（官方文档）：
  seed 选填整数；prompt 必填 1-20000 字符；duration 选填 1-15 秒；resolution 选填
  （480p竖/768p竖/480p横/768p横/480p(1:1)/768p(1:1)）；
  ref_image_0（必填）到 ref_image_8、ref_audio_0 到 ref_audio_2：值都是文件 URL。
  没有 negative_prompt 和台词参数——台词、负向提示词都要拼进 prompt（见「台词写法」「负向写法」模板）。

请求体里用哪些字段名、工作流 ID，都来自账号类型的生成配置（存数据库，账号设置里改），不在代码或 .env 里。
仍需实测确认（标注 VERIFY）：results 的具体格式——这里会递归查找其中的 http 链接，找不到时错误信息里会带上原始内容。
"""
import base64
import ipaddress
import json
import logging
from pathlib import Path
from urllib.parse import urlparse

import httpx

from app.core.config import Settings
from app.core.exceptions import ProviderError
from app.core.logging import redact
from app.domain.status import TaskStatus
from app.providers.base import ProviderStatus, SubmitRequest

logger = logging.getLogger(__name__)

_OK_CODE = "Success"
_SUCCESS = {"SUCCESS"}
_FAILED = {"FAILED"}
_RUNNING = {"QUEUED", "RUNNING"}
_VIDEO_EXT = (".mp4", ".mov", ".webm", ".mkv")
_URL_KEYS = ("video_url", "url", "file_url", "download_url", "path")


def _is_public_url(url: str | None) -> bool:
    """AutoDL 要自己去下载参考图，所以地址必须是公网可访问的；本机和内网地址一定拉不到。"""
    host = (urlparse(url or "").hostname or "").lower()
    if not host or host == "localhost" or host.endswith((".local", ".internal")):
        return False
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return True  # 普通域名
    return not (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved)


def collect_urls(obj: object) -> list[str]:
    """递归收集 results 里的 http(s) 链接（结果可能是字符串列表，也可能是对象列表）。"""
    if isinstance(obj, str):
        return [obj] if obj.startswith(("http://", "https://")) else []
    if isinstance(obj, dict):
        urls: list[str] = []
        for key in _URL_KEYS:  # 常见字段优先
            urls += collect_urls(obj.get(key))
        for key, value in obj.items():
            if key not in _URL_KEYS:
                urls += collect_urls(value)
        return urls
    if isinstance(obj, list):
        return [u for item in obj for u in collect_urls(item)]
    return []


def pick_video_url(results: object) -> str | None:
    urls = collect_urls(results)
    for u in urls:
        if urlparse(u).path.lower().endswith(_VIDEO_EXT):
            return u
    return urls[0] if urls else None


class AutoDLComfyUIProvider:
    name = "autodl"

    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.s = settings
        self._secrets = [settings.autodl_api_token]
        self._transport = transport  # 测试时注入 httpx.MockTransport

    # ---------- 内部工具 ----------
    def _check_configured(self) -> None:
        if not (self.s.autodl_base_url and self.s.autodl_api_token):
            raise ProviderError("PROVIDER_NOT_CONFIGURED", "未配置 AUTODL_BASE_URL / AUTODL_API_TOKEN")

    def _client(self) -> httpx.AsyncClient:
        headers = {self.s.autodl_auth_header: f"{self.s.autodl_auth_prefix}{self.s.autodl_api_token}"}
        return httpx.AsyncClient(
            base_url=self.s.autodl_base_url, headers=headers, transport=self._transport,
            timeout=httpx.Timeout(self.s.autodl_request_timeout_seconds),
        )

    def _http_error(self, status_code: int, body: str, *, submitting: bool) -> ProviderError:
        msg = redact(f"HTTP {status_code}: {body[:200]}", self._secrets)
        if status_code in (401, 403):
            return ProviderError("PROVIDER_AUTH_FAILED", msg)
        if status_code in (400, 404, 422):
            return ProviderError("PROVIDER_BAD_REQUEST", msg)
        # 504 说明网关等不到后端，任务可能已创建，提交时按“结果不确定”处理
        uncertain = submitting and status_code == 504
        return ProviderError("PROVIDER_UNAVAILABLE", msg, retryable=True, submit_uncertain=uncertain)

    def _check_code(self, body: dict, *, submitting: bool) -> dict:
        """HTTP 200 也可能带业务错误码：code != Success 时按服务端明确拒绝处理。"""
        if body.get("code") != _OK_CODE:
            msg = redact(f"{body.get('code')}: {body.get('msg') or '服务端返回失败'}", self._secrets)
            # 提交被明确拒绝：任务肯定没创建，不重试；查询阶段的业务错误可能是暂时的，交给超时兜底
            raise ProviderError("PROVIDER_BAD_REQUEST", msg, retryable=not submitting)
        data = body.get("data")
        return data if isinstance(data, dict) else {}

    # ---------- 接口实现 ----------
    async def submit(self, req: SubmitRequest) -> str:
        self._check_configured()
        if not req.config or not req.config.workflow_id:
            raise ProviderError("PROVIDER_NOT_CONFIGURED", "该账号类型还没有配置 AutoDL 工作流 ID（账号设置里填写）")
        workflow_id = req.config.workflow_id

        payload = self._build_payload(req)  # 参数缺配置时在发请求之前就失败，不产生任何费用
        path = self.s.autodl_submit_path.format(workflow_id=workflow_id)
        try:
            async with self._client() as client:
                resp = await client.post(path, json=payload)
        except (httpx.ConnectError, httpx.ConnectTimeout) as e:
            # 连接都没建立，请求一定没到服务端，可以安全重试
            raise ProviderError("PROVIDER_UNREACHABLE", f"无法连接 AutoDL: {type(e).__name__}", retryable=True) from e
        except httpx.HTTPError as e:
            # 请求可能已发出（读超时/连接中断），不能确定外部任务是否已创建
            raise ProviderError(
                "SUBMIT_UNCERTAIN", f"提交后未收到响应: {type(e).__name__}", retryable=True, submit_uncertain=True
            ) from e

        if resp.status_code >= 400:
            raise self._http_error(resp.status_code, resp.text, submitting=True)
        try:
            data = self._check_code(resp.json(), submitting=True)
        except ValueError as e:  # 200 但不是 JSON
            raise ProviderError("SUBMIT_UNCERTAIN", "提交响应不是合法 JSON", submit_uncertain=True) from e
        task_id = data.get("task_id")
        if not task_id:
            # 响应里没有任务 ID，但请求可能已经被受理
            raise ProviderError("SUBMIT_UNCERTAIN", "提交响应缺少 task_id", submit_uncertain=True)
        return str(task_id)

    async def get_status(self, provider_task_id: str) -> ProviderStatus:
        self._check_configured()
        path = self.s.autodl_result_path.format(task_id=provider_task_id)
        try:
            async with self._client() as client:
                resp = await client.get(path)
        except httpx.HTTPError as e:
            raise ProviderError("PROVIDER_UNREACHABLE", f"查询失败: {type(e).__name__}", retryable=True) from e
        if resp.status_code >= 400:
            raise self._http_error(resp.status_code, resp.text, submitting=False)
        try:
            data = self._check_code(resp.json(), submitting=False)
        except ValueError as e:
            raise ProviderError("PROVIDER_BAD_RESPONSE", "查询响应不是合法 JSON", retryable=True) from e
        return self._parse_status(data)

    async def download_result(self, status: ProviderStatus, dest: Path, max_bytes: int) -> str:
        url = status.video_url or ""
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        allowed = {(urlparse(self.s.autodl_base_url).hostname or "").lower(), *self.s.result_allowed_host_list}
        # 防 SSRF：只允许 http(s) 且域名在白名单内
        if parsed.scheme not in ("http", "https") or host not in allowed:
            raise ProviderError(
                "RESULT_URL_NOT_ALLOWED",
                f"结果地址的域名 {host or '(空)'} 不在允许列表，确认可信后请加入 AUTODL_RESULT_ALLOWED_HOSTS",
            )
        timeout = httpx.Timeout(self.s.autodl_download_timeout_seconds)
        size = 0
        try:
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=False, transport=self._transport) as client:
                async with client.stream("GET", url) as resp:
                    if resp.status_code >= 400:
                        raise ProviderError("RESULT_DOWNLOAD_FAILED", f"下载失败 HTTP {resp.status_code}", retryable=True)
                    content_type = resp.headers.get("content-type", "video/mp4").split(";")[0]
                    with dest.open("wb") as f:
                        async for chunk in resp.aiter_bytes(1024 * 256):
                            size += len(chunk)
                            if size > max_bytes:
                                raise ProviderError("RESULT_TOO_LARGE", "结果文件超过大小限制")
                            f.write(chunk)
        except httpx.HTTPError as e:
            raise ProviderError("RESULT_DOWNLOAD_FAILED", f"下载中断: {type(e).__name__}", retryable=True) from e
        return content_type

    async def ping(self) -> dict:
        info = {
            "provider": self.name,
            "configured": bool(self.s.autodl_base_url and self.s.autodl_api_token),
            "reachable": None,
        }
        if info["configured"]:
            try:
                async with httpx.AsyncClient(timeout=5, transport=self._transport) as client:
                    await client.get(self.s.autodl_base_url)
                info["reachable"] = True  # 只代表网络通，不代表 Token 有效
            except httpx.HTTPError:
                info["reachable"] = False
        return info

    # ---------- 与真实 API 对接的映射 ----------
    def _build_payload(self, req: SubmitRequest) -> dict:
        """按账号类型配置里的字段名（req.config.fields，存数据库）组装请求体。

        prompt / duration / resolution / seed 默认可用；字段名留空表示不传。
        台词、参考图：业务上必须传，字段名没配置就直接报错，避免“悄悄丢掉”后白白生成。
        """
        cfg = req.config
        if cfg is None:
            raise ProviderError("PROVIDER_NOT_CONFIGURED", "缺少账号类型的生成配置")
        f = cfg.fields
        option = cfg.resolution(req.resolution)
        payload: dict = {
            f.prompt: req.prompt,
            f.duration: req.duration_seconds,
            # 官方示例里 resolution 传的是选项标签（如 "480p竖"）
            f.resolution: option.label if option else req.resolution,
        }
        if req.seed is not None and f.seed:
            payload[f.seed] = req.seed
        if req.negative_prompt and f.negative_prompt:
            payload[f.negative_prompt] = req.negative_prompt
        if req.dialogue:
            if not f.dialogue:
                raise ProviderError("PROVIDER_NOT_CONFIGURED", "该任务带台词，但账号设置里没有配置台词字段名")
            payload[f.dialogue] = req.dialogue
        if req.images:
            if not f.images:
                raise ProviderError("PROVIDER_NOT_CONFIGURED", "该任务带参考图，但账号设置里没有配置图片字段前缀（如 ref_image_）")
            for i, img in enumerate(req.images):
                if f.image_mode == "url":
                    if not _is_public_url(img.url):
                        raise ProviderError(
                            "PROVIDER_NOT_CONFIGURED",
                            "参考图地址是本机或内网地址，AutoDL 访问不到。请把 PUBLIC_BASE_URL 配成公网可访问的地址，"
                            "或改用对象存储",
                        )
                    payload[f"{f.images}{i}"] = img.url  # 官方文档：ref_image_N 的值是图片 URL
                else:
                    payload[f"{f.images}{i}"] = base64.b64encode(img.data).decode()
        return payload

    @staticmethod
    def _parse_status(data: dict) -> ProviderStatus:
        raw = str(data.get("status") or "").upper()
        if raw in _SUCCESS:
            results = data.get("results")
            url = pick_video_url(results)
            if not url:
                # 成功但找不到视频地址：不能标记成功，并把原始 results 带进错误信息便于适配
                shown = json.dumps(results, ensure_ascii=False)[:300]
                return ProviderStatus(TaskStatus.FAILED, error_code="RESULT_MISSING",
                                      error_message=f"外部任务成功但无法识别视频地址，results={shown}")
            return ProviderStatus(TaskStatus.SUCCEEDED, video_url=url)
        if raw in _FAILED:
            reason = data.get("error") or data.get("message") or data.get("msg") or "外部任务失败"
            return ProviderStatus(TaskStatus.FAILED, error_code="PROVIDER_TASK_FAILED", error_message=str(reason)[:500])
        if raw not in _RUNNING:
            logger.warning("unknown provider status=%r, treat as running", raw)
        return ProviderStatus(TaskStatus.RUNNING)
