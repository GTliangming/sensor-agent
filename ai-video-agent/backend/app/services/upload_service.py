"""图片上传：校验大小与真实文件格式后落存储。"""
import uuid

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.exceptions import ValidationFailed
from app.models import UploadedFile
from app.repositories.uploaded_file_repository import UploadedFileRepository
from app.storage.base import Storage

# 通过文件头识别真实格式，不信任客户端声明的 Content-Type
_SIGNATURES: list[tuple[bytes, str, str]] = [
    (b"\x89PNG\r\n\x1a\n", "image/png", "png"),
    (b"\xff\xd8\xff", "image/jpeg", "jpg"),
]


def sniff_image(data: bytes) -> tuple[str, str] | None:
    for sig, mime, ext in _SIGNATURES:
        if data.startswith(sig):
            return mime, ext
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", "webp"
    return None


class UploadService:
    def __init__(self, db: Session, storage: Storage, settings: Settings) -> None:
        self.db, self.storage, self.s = db, storage, settings
        self.repo = UploadedFileRepository(db)

    def save_image(self, data: bytes, original_name: str | None) -> UploadedFile:
        if not data:
            raise ValidationFailed("上传文件为空")
        if len(data) > self.s.max_upload_bytes:
            raise ValidationFailed(f"图片不能超过 {self.s.max_upload_bytes // 1024 // 1024} MB")
        sniffed = sniff_image(data)
        if not sniffed:
            raise ValidationFailed("仅支持 PNG / JPEG / WEBP 图片")
        mime, ext = sniffed

        file_id = str(uuid.uuid4())
        key = f"inputs/{file_id}.{ext}"  # 路径完全由服务端生成，不使用客户端文件名
        self.storage.save_bytes(key, data)
        record = UploadedFile(
            id=file_id, storage_key=key, content_type=mime, size_bytes=len(data),
            original_name=(original_name or "")[:255] or None,
        )
        self.repo.add(record)
        self.db.commit()
        return record
