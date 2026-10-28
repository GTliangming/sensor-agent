"""本地存储文件访问。FileResponse 支持 HTTP Range，视频可拖动进度。

接入对象存储后，get_url 会直接返回签名 URL，这个路由可以保留给本地开发。
"""
from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse

from app.core.exceptions import NotFoundError
from app.storage.factory import get_storage
from app.storage.local_storage import LocalStorage

router = APIRouter(tags=["files"])

_ALLOWED_PREFIXES = ("videos/", "inputs/", "thumbnails/")


@router.get("/files/{key:path}")
def get_file(key: str, storage: LocalStorage = Depends(get_storage)) -> FileResponse:
    if not key.startswith(_ALLOWED_PREFIXES) or not storage.exists(key):
        raise NotFoundError("文件不存在")
    return FileResponse(storage.resolve(key))
