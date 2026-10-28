"""AutoDL Provider：用官方示例里的请求/响应结构，通过 httpx.MockTransport 验证适配逻辑。"""
import json

import httpx
import pytest

from app.core.config import Settings
from app.core.exceptions import ProviderError
from app.domain.generation_config import GenerationConfig
from app.domain.status import TaskStatus
from app.providers.autodl_comfyui import AutoDLComfyUIProvider, pick_video_url
from app.providers.base import ImagePart, ProviderStatus, SubmitRequest

SUBMIT_OK = {
    "code": "Success",
    "data": {"task_id": "2a25da1d-39ad-495c-8dac-bae8e8f6b1a1", "workflow": "H3文生视频", "status": "QUEUED",
             "message": "工作流任务已提交"},
    "msg": "", "request_id": "r1",
}


def _settings(**kw) -> Settings:
    base = dict(autodl_base_url="https://autodl.art", autodl_api_token="tok-123")
    return Settings(**{**base, **kw})


def _config(fields: dict | None = None, **kw) -> GenerationConfig:
    """账号类型的生成配置（真实环境里存在数据库）：工作流 ID 与请求字段名都在这里。"""
    data = dict(
        workflow_id="wf-h3", default_resolution="480p竖",
        resolutions=[{"label": l, "aspect_ratio": "9:16"} for l in ("480p横", "480p竖", "768p横", "768p竖")],
        fields=fields or {},
    )
    return GenerationConfig(**{**data, **kw})


def _req(fields: dict | None = None, **kw) -> SubmitRequest:
    base = dict(request_token="t", workflow_key="h3_reference_video", prompt="小猫在云端漫步",
                negative_prompt=None, aspect_ratio="9:16", duration_seconds=5, config=_config(fields))
    return SubmitRequest(**{**base, **kw})


def _provider(handler, **settings_kw) -> AutoDLComfyUIProvider:
    return AutoDLComfyUIProvider(_settings(**settings_kw), transport=httpx.MockTransport(handler))


async def test_submit_matches_official_example():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(path=request.url.path, auth=request.headers["Authorization"], body=json.loads(request.content))
        return httpx.Response(200, json=SUBMIT_OK)

    task_id = await _provider(handler).submit(_req())
    assert task_id == "2a25da1d-39ad-495c-8dac-bae8e8f6b1a1"
    assert seen["path"] == "/api/v1/comfyui/comfyui_workflow/wf-h3"  # 工作流 ID 来自数据库里的配置
    assert seen["auth"] == "tok-123"  # 直接放 Token，不带 Bearer
    assert seen["body"] == {"prompt": "小猫在云端漫步", "duration": 5, "resolution": "480p竖"}


async def test_workflow_id_comes_from_config_not_env():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        return httpx.Response(200, json=SUBMIT_OK)

    req = _req()
    req.config = _config(workflow_id="another-workflow")
    await _provider(handler, autodl_workflow_id="env-should-be-ignored").submit(req)
    assert seen["path"].endswith("/another-workflow")

    req.config = _config(workflow_id="")
    with pytest.raises(ProviderError) as e:
        await _provider(handler).submit(req)
    assert e.value.code == "PROVIDER_NOT_CONFIGURED" and "工作流 ID" in e.value.message


async def test_resolution_label_and_seed_come_from_the_task():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(body=json.loads(request.content))
        return httpx.Response(200, json=SUBMIT_OK)

    await _provider(handler).submit(_req(resolution="768p横", seed=683072603085674))
    assert seen["body"]["resolution"] == "768p横" and seen["body"]["seed"] == 683072603085674


async def test_dialogue_and_optional_fields_use_configured_names():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(body=json.loads(request.content))
        return httpx.Response(200, json=SUBMIT_OK)

    fields = {"dialogue": "dlg", "negative_prompt": "neg", "seed": "noise_seed"}
    await _provider(handler).submit(_req(fields, dialogue="早点睡", negative_prompt="水印", seed=7))
    assert seen["body"]["dlg"] == "早点睡"
    assert seen["body"]["neg"] == "水印" and seen["body"]["noise_seed"] == 7


async def test_h3_request_body_matches_the_official_parameter_list():
    """官方文档：参考图是编号字段 ref_image_0..，值是图片 URL；没有 negative_prompt 和台词参数。"""
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(body=json.loads(request.content))
        return httpx.Response(200, json=SUBMIT_OK)

    fields = {"images": "ref_image_", "audios": "ref_audio_", "image_mode": "url"}
    images = [ImagePart(b"a", "image/png", f"https://img.example.com/{i}.png") for i in range(3)]
    await _provider(handler).submit(_req(fields, images=images, resolution="768p竖", seed=1, duration_seconds=15,
                                         negative_prompt="不会发送", dialogue=None))
    assert seen["body"] == {
        "prompt": "小猫在云端漫步", "duration": 15, "resolution": "768p竖", "seed": 1,
        "ref_image_0": "https://img.example.com/0.png", "ref_image_1": "https://img.example.com/1.png",
        "ref_image_2": "https://img.example.com/2.png",
    }


async def test_image_mode_base64_sends_content():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(body=json.loads(request.content))
        return httpx.Response(200, json=SUBMIT_OK)

    await _provider(handler).submit(_req({"images": "img_", "image_mode": "base64"},
                                         images=[ImagePart(b"abc", "image/png", None)]))
    assert seen["body"]["img_0"] == "YWJj"


async def test_local_image_urls_are_rejected_because_autodl_cannot_fetch_them():
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("不应该发出请求")

    for url in ("http://127.0.0.1:8000/api/v1/files/inputs/a.png", "http://localhost/a.png",
                "http://192.168.1.8/a.png", "http://10.0.0.5/a.png"):
        with pytest.raises(ProviderError) as e:
            await _provider(handler).submit(_req({"images": "ref_image_"}, images=[ImagePart(b"x", "image/png", url)]))
        assert e.value.code == "PROVIDER_NOT_CONFIGURED" and "PUBLIC_BASE_URL" in e.value.message


async def test_missing_field_config_fails_before_any_request():
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("不应该发出请求")

    p = _provider(handler)
    with pytest.raises(ProviderError) as e1:
        await p.submit(_req(dialogue="台词"))
    with pytest.raises(ProviderError) as e2:
        await p.submit(_req(images=[ImagePart(b"x", "image/png", None)]))
    assert e1.value.code == e2.value.code == "PROVIDER_NOT_CONFIGURED" and not e1.value.retryable


async def test_business_error_code_is_definite_rejection():
    body = {"code": "InvalidParams", "data": None, "msg": "duration 超出范围"}
    p = _provider(lambda r: httpx.Response(200, json=body))
    with pytest.raises(ProviderError) as e:
        await p.submit(_req())
    assert e.value.code == "PROVIDER_BAD_REQUEST" and not e.value.submit_uncertain and not e.value.retryable
    assert "duration 超出范围" in e.value.message


async def test_http_401_is_auth_failed_and_token_not_leaked():
    p = _provider(lambda r: httpx.Response(401, text="bad token tok-123"))
    with pytest.raises(ProviderError) as e:
        await p.submit(_req())
    assert e.value.code == "PROVIDER_AUTH_FAILED" and "tok-123" not in e.value.message


async def test_read_timeout_after_send_is_uncertain():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    with pytest.raises(ProviderError) as e:
        await _provider(handler).submit(_req())
    assert e.value.submit_uncertain


def _query(data: dict):
    return lambda r: httpx.Response(200, json={"code": "Success", "data": data, "msg": ""})


async def test_status_mapping():
    running = await _provider(_query({"task_id": "x", "status": "RUNNING", "duration": 196, "results": []})).get_status("x")
    queued = await _provider(_query({"task_id": "x", "status": "QUEUED"})).get_status("x")
    failed = await _provider(_query({"task_id": "x", "status": "FAILED", "message": "显存不足"})).get_status("x")
    ok = await _provider(_query({"task_id": "x", "status": "SUCCESS",
                                 "results": ["https://autodl.art/files/a.mp4"]})).get_status("x")
    assert running.status == queued.status == TaskStatus.RUNNING
    assert failed.status == TaskStatus.FAILED and "显存不足" in failed.error_message
    assert ok.status == TaskStatus.SUCCEEDED and ok.video_url == "https://autodl.art/files/a.mp4"


async def test_status_query_uses_result_path():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        return httpx.Response(200, json={"code": "Success", "data": {"status": "RUNNING"}})

    await _provider(handler).get_status("abc")
    assert seen["path"] == "/api/v1/comfyui/comfyui_workflow/result/abc"


async def test_success_without_recognizable_url_is_not_marked_succeeded():
    st = await _provider(_query({"status": "SUCCESS", "results": [{"filename": "a.mp4", "subfolder": ""}]})).get_status("x")
    assert st.status == TaskStatus.FAILED and st.error_code == "RESULT_MISSING" and "filename" in st.error_message


def test_pick_video_url_handles_nested_results():
    results = [{"type": "image", "url": "https://cdn.x/a.png"}, {"outputs": {"video": "https://cdn.x/b.mp4?sig=1"}}]
    assert pick_video_url(results) == "https://cdn.x/b.mp4?sig=1"
    assert pick_video_url([]) is None


async def test_download_enforces_host_allowlist_and_size(tmp_path):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"x" * 100, headers={"content-type": "video/mp4"})

    p = _provider(handler, autodl_result_allowed_hosts="cdn.example.com")
    ok = ProviderStatus(TaskStatus.SUCCEEDED, video_url="https://cdn.example.com/a.mp4")
    assert await p.download_result(ok, tmp_path / "a.mp4", 1000) == "video/mp4"
    assert (tmp_path / "a.mp4").stat().st_size == 100

    with pytest.raises(ProviderError) as too_big:
        await p.download_result(ok, tmp_path / "b.mp4", 50)
    assert too_big.value.code == "RESULT_TOO_LARGE"

    evil = ProviderStatus(TaskStatus.SUCCEEDED, video_url="https://evil.example.org/a.mp4")
    with pytest.raises(ProviderError) as blocked:
        await p.download_result(evil, tmp_path / "c.mp4", 1000)
    assert blocked.value.code == "RESULT_URL_NOT_ALLOWED" and "evil.example.org" in blocked.value.message
