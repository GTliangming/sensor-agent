"""FastAPI 依赖注入：集中创建 service，路由里不手动拼装。"""
from fastapi import Depends
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.services.account_service import AccountService
from app.services.production_service import ProductionService
from app.services.template_service import TemplateService
from app.services.upload_service import UploadService
from app.services.video_service import VideoService
from app.storage.base import Storage
from app.storage.factory import get_storage


def get_account_service(db: Session = Depends(get_db)) -> AccountService:
    return AccountService(db)


def get_template_service(db: Session = Depends(get_db)) -> TemplateService:
    return TemplateService(db)


def get_production_service(
    db: Session = Depends(get_db),
    storage: Storage = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> ProductionService:
    return ProductionService(db, storage, settings)


def get_video_service(
    db: Session = Depends(get_db),
    storage: Storage = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> VideoService:
    return VideoService(db, storage, settings)


def get_upload_service(
    db: Session = Depends(get_db),
    storage: Storage = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> UploadService:
    return UploadService(db, storage, settings)
