"""提示词模板数据访问。"""
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import PromptTemplate


class TemplateRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def add(self, t: PromptTemplate) -> None:
        self.db.add(t)
        self.db.flush()

    def get(self, template_id: str) -> PromptTemplate | None:
        return self.db.get(PromptTemplate, template_id)

    def list_active(self, kind: str | None = None) -> list[PromptTemplate]:
        stmt = select(PromptTemplate).where(PromptTemplate.is_active.is_(True))
        if kind:
            stmt = stmt.where(PromptTemplate.kind == kind)
        return list(self.db.scalars(stmt.order_by(PromptTemplate.kind, PromptTemplate.name)))

    def list_versions(self, group_id: str) -> list[PromptTemplate]:
        stmt = select(PromptTemplate).where(PromptTemplate.group_id == group_id).order_by(PromptTemplate.version.desc())
        return list(self.db.scalars(stmt))

    def deactivate_group(self, group_id: str) -> None:
        self.db.execute(update(PromptTemplate).where(PromptTemplate.group_id == group_id).values(is_active=False))
