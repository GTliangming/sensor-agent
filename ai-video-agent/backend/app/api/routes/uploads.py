"""图片上传。"""
from fastapi import APIRouter, Depends, File, UploadFile

from app.api.deps import get_upload_service
from app.core.config import get_settings
from app.schemas.common import ApiResponse, ok
from app.schemas.upload import UploadOut
from app.services.upload_service import UploadService
from app.storage.factory import get_storage

router = APIRouter(prefix="/uploads", tags=["uploads"])


@router.post("", response_model=ApiResponse[UploadOut], status_code=201)
async def upload_image(file: UploadFile = File(...), svc: UploadService = Depends(get_upload_service)) -> dict:
    # 多读 1 字节用于判断是否超限，避免把超大文件整个读进内存
    limit = get_settings().max_upload_bytes
    data = await file.read(limit + 1)
    record = svc.save_image(data, file.filename)
    return ok(UploadOut(
        file_id=record.id, url=get_storage().get_url(record.storage_key),
        content_type=record.content_type, size_bytes=record.size_bytes,
    ), "上传成功")
