import pytest

from app.providers.image.base import cache_key, validate_image_file
from app.providers.image.fake import FakeImageProvider


@pytest.mark.asyncio
async def test_fake_image_is_valid_png(tmp_path):
    out = tmp_path / "a.png"
    await FakeImageProvider().generate("城市 夜景", width=928, height=1664,
                                       idempotency_key="k", out_path=out)
    w, h = validate_image_file(out)
    assert w > 0 and h > 0
    assert out.stat().st_size > 64


def test_validate_rejects_garbage(tmp_path):
    bad = tmp_path / "bad.png"
    bad.write_bytes(b"not an image at all ........................")
    with pytest.raises(ValueError):
        validate_image_file(bad)


def test_cache_key_is_deterministic_and_size_sensitive():
    k1 = cache_key("siliconflow", "Qwen/Qwen-Image", "a prompt", 928, 1664)
    k2 = cache_key("siliconflow", "Qwen/Qwen-Image", "a  prompt ", 928, 1664)  # 归一化空白
    k3 = cache_key("siliconflow", "Qwen/Qwen-Image", "a prompt", 1024, 1024)
    assert k1 == k2
    assert k1 != k3
