"""上传相关结构。"""
from pydantic import BaseModel


class UploadOut(BaseModel):
    file_id: str
    url: str
    content_type: str
    size_bytes: int
