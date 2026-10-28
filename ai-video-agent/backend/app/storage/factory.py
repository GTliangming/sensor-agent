"""按 STORAGE_BACKEND 创建存储（进程内单例）。"""
from functools import lru_cache

from app.core.config import get_settings
from app.storage.base import Storage
from app.storage.local_storage import LocalStorage


@lru_cache
def get_storage() -> Storage:
    s = get_settings()
    if s.storage_backend == "local":
        return LocalStorage(s.local_storage_dir, s.public_base_url)
    if s.storage_backend == "qiniu":
        from app.storage.qiniu_storage import QiniuStorage

        return QiniuStorage(s.qiniu_access_key, s.qiniu_secret_key, s.qiniu_bucket, s.qiniu_domain, s.qiniu_use_https)
    raise ValueError(f"不支持的 STORAGE_BACKEND: {s.storage_backend}（可选 local | qiniu）")
