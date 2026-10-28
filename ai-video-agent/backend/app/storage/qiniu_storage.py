"""七牛云对象存储。空间需绑定公网下载域名（公开空间），get_url 直接拼 {协议}://{域名}/{key}。"""
from pathlib import Path

import httpx

from app.storage.base import Storage


class QiniuStorage(Storage):
    def __init__(self, access_key: str, secret_key: str, bucket: str, domain: str, use_https: bool = True) -> None:
        missing = [n for n, v in (("QINIU_ACCESS_KEY", access_key), ("QINIU_SECRET_KEY", secret_key),
                                  ("QINIU_BUCKET", bucket), ("QINIU_DOMAIN", domain)) if not v]
        if missing:
            raise ValueError(f"STORAGE_BACKEND=qiniu 需要配置: {', '.join(missing)}")
        from qiniu import Auth  # 只在用到七牛时才导入

        self.auth, self.bucket = Auth(access_key, secret_key), bucket
        self.base_url = f"{'https' if use_https else 'http'}://{domain.strip('/')}"

    def save_bytes(self, key: str, data: bytes) -> None:
        from qiniu import put_data

        _, info = put_data(self.auth.upload_token(self.bucket, key), key, data)
        self._check(info, f"上传 {key}")

    def save_file(self, key: str, path: Path) -> None:
        from qiniu import put_file

        _, info = put_file(self.auth.upload_token(self.bucket, key), key, str(path))
        self._check(info, f"上传 {key}")

    def read_bytes(self, key: str) -> bytes:
        r = httpx.get(self.get_url(key), timeout=60, follow_redirects=True)
        r.raise_for_status()
        return r.content

    def delete(self, key: str) -> None:
        from qiniu import BucketManager

        _, info = BucketManager(self.auth).delete(self.bucket, key)
        if info.status_code not in (200, 612):  # 612：文件不存在
            self._check(info, f"删除 {key}")

    def get_url(self, key: str) -> str:
        return f"{self.base_url}/{key}"

    @staticmethod
    def _check(info, action: str) -> None:
        if info.status_code != 200:
            raise RuntimeError(f"七牛{action}失败: HTTP {info.status_code} {info.text_body}")
