"""上传文件元数据访问。"""
from sqlalchemy.orm import Session

from app.models import UploadedFile


class UploadedFileRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def add(self, f: UploadedFile) -> None:
        self.db.add(f)
        self.db.flush()

    def get(self, file_id: str) -> UploadedFile | None:
        return self.db.get(UploadedFile, file_id)
