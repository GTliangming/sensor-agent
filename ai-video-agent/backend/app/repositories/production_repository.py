"""生产流程数据访问：与视频任务仓库相同，状态变更一律用条件 UPDATE。"""
from collections.abc import Iterable
from datetime import timedelta

from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.domain.production_status import REVIEW_STATUSES, ProductionStatus, can_transition
from app.models import Production, ProductionArtifact, ProductionReview


class ProductionRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    # ---------- 基础读写 ----------
    def add(self, p: Production) -> None:
        self.db.add(p)
        self.db.flush()

    def get(self, production_id: str) -> Production | None:
        return self.db.get(Production, production_id)

    def recent_topics(self, account_id: str, limit: int) -> list[str]:
        stmt = (select(Production.topic).where(Production.account_id == account_id, Production.topic != "")
                .order_by(Production.created_at.desc()).limit(limit))
        return list(self.db.scalars(stmt))

    def list_page(
        self, *, page: int, page_size: int, status: str | None = None,
        needs_review: bool = False, account_id: str | None = None,
    ) -> tuple[list[Production], int]:
        conds = []
        if status:
            conds.append(Production.status == status)
        if needs_review:
            conds.append(Production.status.in_([s.value for s in REVIEW_STATUSES]))
        if account_id:
            conds.append(Production.account_id == account_id)
        total = self.db.scalar(select(func.count()).select_from(Production).where(*conds)) or 0
        stmt = (select(Production).where(*conds).order_by(Production.created_at.desc())
                .offset((page - 1) * page_size).limit(page_size))
        return list(self.db.scalars(stmt)), total

    # ---------- 条件状态流转 ----------
    def transition(
        self, production_id: str, from_statuses: Iterable[ProductionStatus], to: ProductionStatus,
        values: dict | None = None,
    ) -> bool:
        """原子地从 from_statuses 之一流转到 to；状态已被别人改过（如已废弃）返回 False。"""
        for src in from_statuses:
            if not can_transition(src, to):
                continue
            r = self.db.execute(
                update(Production).where(Production.id == production_id, Production.status == src.value)
                .values(status=to.value, updated_at=utcnow(), **(values or {}))
            )
            if r.rowcount == 1:
                return True
        return False

    def update_fields(self, production_id: str, values: dict) -> None:
        self.db.execute(update(Production).where(Production.id == production_id).values(updated_at=utcnow(), **values))

    # ---------- LLM 阶段的租约 ----------
    def claim_next(self, worker_id: str, lease_seconds: int) -> Production | None:
        now = utcnow()
        free = or_(Production.claimed_by.is_(None), Production.lease_expires_at < now)
        generating = [ProductionStatus.SCENE_GENERATING.value]
        stmt = (select(Production.id, Production.status)
                .where(Production.status.in_(generating), free).order_by(Production.created_at).limit(5))
        for pid, seen in self.db.execute(stmt).all():
            r = self.db.execute(
                update(Production).where(Production.id == pid, Production.status == seen, free)
                .values(claimed_by=worker_id, lease_expires_at=now + timedelta(seconds=lease_seconds))
            )
            if r.rowcount == 1:
                self.db.commit()
                self.db.expire_all()
                return self.get(pid)
            self.db.rollback()
        return None

    def list_syncable(self) -> list[Production]:
        """已建视频任务、需要把任务状态同步回来的生产。"""
        active = [ProductionStatus.QUEUED.value, ProductionStatus.GENERATING.value]
        return list(self.db.scalars(
            select(Production).where(Production.status.in_(active), Production.video_task_id.is_not(None))
        ))

    # ---------- 产物与审核 ----------
    def add_artifact(
        self, production_id: str, kind: str, content: dict, source: str, *,
        template_id: str | None = None, rendered_prompt: str | None = None, feedback: str | None = None,
    ) -> ProductionArtifact:
        latest = self.current_artifact(production_id, kind)
        art = ProductionArtifact(
            production_id=production_id, kind=kind, version=(latest.version + 1) if latest else 1,
            content=content, source=source, template_id=template_id,
            rendered_prompt=rendered_prompt, feedback=feedback,
        )
        self.db.add(art)
        self.db.flush()
        return art

    def current_artifact(self, production_id: str, kind: str) -> ProductionArtifact | None:
        stmt = (select(ProductionArtifact)
                .where(ProductionArtifact.production_id == production_id, ProductionArtifact.kind == kind)
                .order_by(ProductionArtifact.version.desc()).limit(1))
        return self.db.scalar(stmt)

    def list_artifacts(self, production_id: str) -> list[ProductionArtifact]:
        stmt = (select(ProductionArtifact).where(ProductionArtifact.production_id == production_id)
                .order_by(ProductionArtifact.kind, ProductionArtifact.version))
        return list(self.db.scalars(stmt))

    def add_review(
        self, production_id: str, stage: str, action: str, *,
        comment: str | None = None, artifact_version: int | None = None,
    ) -> None:
        self.db.add(ProductionReview(
            production_id=production_id, stage=stage, action=action,
            comment=comment, artifact_version=artifact_version,
        ))

    def list_reviews(self, production_id: str) -> list[ProductionReview]:
        stmt = select(ProductionReview).where(ProductionReview.production_id == production_id).order_by(ProductionReview.id)
        return list(self.db.scalars(stmt))
