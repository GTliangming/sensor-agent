"""导入所有模型，确保 Base.metadata 完整（Alembic 与测试建表都依赖这一点）。"""
from app.models.account import Account, BusinessLine
from app.models.production import Production, ProductionArtifact, ProductionReview
from app.models.prompt_template import PromptTemplate
from app.models.uploaded_file import UploadedFile
from app.models.video_task import VideoTask
from app.models.video_task_event import VideoTaskAttempt, VideoTaskEvent

__all__ = [
    "Account", "BusinessLine", "Production", "ProductionArtifact", "ProductionReview", "PromptTemplate",
    "UploadedFile", "VideoTask", "VideoTaskAttempt", "VideoTaskEvent",
]
