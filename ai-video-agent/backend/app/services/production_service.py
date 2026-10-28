"""生产流程业务逻辑（API 侧）：创建，以及三个审核点上的人工操作。

LLM 调用和视频生成都不在这里做——这里只改数据库状态，真正的执行在 Worker 里，
所以每个接口都能立即返回，人工随时可以打断。
"""
import secrets
import uuid

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.exceptions import NotFoundError, StateConflict, ValidationFailed
from app.core.time import utcnow
from app.domain.production_status import ALLOWED_ACTIONS, REVIEW_STATUSES, ProductionStatus as S, can_transition
from app.domain.status import ACTIVE_STATUSES, TaskStatus
from app.models import Account, Production, ProductionArtifact, VideoTask
from app.pipeline.assemble import assemble_video_prompt
from app.pipeline.render import render
from app.repositories.account_repository import AccountRepository
from app.repositories.production_repository import ProductionRepository
from app.repositories.video_task_repository import VideoTaskRepository
from app.schemas.production import (
    ApproveDialogueRequest, ApproveSceneRequest, ArtifactOut, ProductionCreate, ProductionDetail,
    ProductionList, ProductionListItem, ReferenceImage, RegenerateVideoRequest, ReviewOut, VideoInfo,
)
from app.services.account_service import load_config
from app.services.template_service import TemplateService
from app.services.video_service import VideoService
from app.storage.base import Storage


def _artifact_out(a: ProductionArtifact) -> ArtifactOut:
    return ArtifactOut(kind=a.kind, version=a.version, source=a.source, content=a.content,
                       feedback=a.feedback, created_at=a.created_at)


class ProductionService:
    def __init__(self, db: Session, storage: Storage, settings: Settings) -> None:
        self.db, self.s, self.storage = db, settings, storage
        self.repo = ProductionRepository(db)
        self.accounts = AccountRepository(db)
        self.tasks = VideoTaskRepository(db)
        self.video = VideoService(db, storage, settings)
        self.templates = TemplateService(db)

    # ---------- 基础 ----------
    def get(self, production_id: str) -> Production:
        p = self.repo.get(production_id)
        if not p:
            raise NotFoundError("生产任务不存在", {"production_id": production_id})
        return p

    def _require(self, p: Production, *expected: S) -> None:
        if S(p.status) not in expected:
            raise StateConflict(f"当前状态为 {p.status}，不能执行该操作", {"status": p.status})

    def _move(self, p: Production, froms: list[S], to: S, values: dict | None = None) -> None:
        """条件流转；失败说明状态刚被别人（或另一个窗口）改过，整体回滚。"""
        if not self.repo.transition(p.id, froms, to, values):
            self.db.rollback()
            raise StateConflict("状态已变化，请刷新后重试", {"status": self.get(p.id).status})

    def _account(self, p: Production) -> Account:
        account = self.accounts.get(p.account_id)
        if not account:
            raise NotFoundError("账号类型不存在", {"account_id": p.account_id})
        return account

    def _save_edit(self, p: Production, changes: dict) -> ProductionArtifact:
        """审核时用户改了内容才新增 human 版本（只覆盖传入的字段），没改就沿用当前版本。"""
        current = self.repo.current_artifact(p.id, "content")
        if current is None:
            raise StateConflict("还没有可审核的内容")
        merged = {**current.content, **{k: v for k, v in changes.items() if v is not None}}
        if merged != current.content:
            return self.repo.add_artifact(p.id, "content", merged, "human")
        return current

    # ---------- 创建 ----------
    def create(self, req: ProductionCreate) -> Production:
        account = self.accounts.get(req.account_id)
        if not account or not account.is_active:
            raise ValidationFailed("账号类型不存在或已停用")
        # 创建时就按数据库里的配置和模板校验，缺什么当场说清楚，不会拖到生成时才发现
        config = load_config(account)
        self.templates.require_complete(account)
        self._check_dialogue_route(account, config)
        negative, _ = self.templates.resolve("video_negative", account)
        self.templates.with_negative(account, config, "", negative)  # 负向提示词没有传递途径时，创建就拒绝
        option, duration = self.video.validate_params(config, req.resolution, req.duration_seconds, req.reference_file_ids)
        seed = req.seed if req.seed is not None else config.seed
        p = Production(
            id=str(uuid.uuid4()), account_id=account.id, topic=req.topic.strip(), run_mode=req.run_mode,
            status=S.SCENE_GENERATING.value, duration_seconds=duration, resolution=option.label, seed=seed,
            reference_file_ids=req.reference_file_ids,
        )
        self.repo.add(p)
        self.db.commit()
        return p

    # ---------- 审核 A：分镜 ----------
    def approve_scene(self, production_id: str, req: ApproveSceneRequest) -> Production:
        p = self.get(production_id)
        self._require(p, S.SCENE_REVIEW)
        scenes = [s.model_dump() for s in req.scenes] if req.scenes else None
        art = self._save_edit(p, {"scenes": scenes})
        self.repo.add_review(p.id, "scene", "approve", artifact_version=art.version)
        self._move(p, [S.SCENE_REVIEW], S.DIALOGUE_REVIEW)
        self.db.commit()
        return p

    def regenerate(self, production_id: str, feedback: str) -> Production:
        """审核 A / B 共用：台词和分镜来自同一次生成，重新生成要整体重来。"""
        p = self.get(production_id)
        self._require(p, S.SCENE_REVIEW, S.DIALOGUE_REVIEW)
        stage = "scene" if p.status == S.SCENE_REVIEW.value else "dialogue"
        self.repo.add_review(p.id, stage, "regenerate", comment=feedback)
        self._move(p, [S(p.status)], S.SCENE_GENERATING, dict(pending_feedback=feedback))
        self.db.commit()
        return p

    # ---------- 审核 B：台词与字幕 ----------
    def approve_dialogue(self, production_id: str, req: ApproveDialogueRequest) -> Production:
        p = self.get(production_id)
        self._require(p, S.DIALOGUE_REVIEW)
        subtitles = [s.model_dump() for s in req.subtitles] if req.subtitles else None
        art = self._save_edit(p, {"tts_text": req.tts_text, "subtitles": subtitles})
        self.repo.add_review(p.id, "dialogue", "approve", artifact_version=art.version)
        task = self._create_video_task(p, art.content)
        self._move(p, [S.DIALOGUE_REVIEW], S.QUEUED, dict(video_task_id=task.id))
        self.db.commit()
        return p

    def back_to_scene(self, production_id: str) -> Production:
        """看了台词发现画面要改：退回审核 A，不调用 LLM。"""
        p = self.get(production_id)
        self._require(p, S.DIALOGUE_REVIEW)
        self.repo.add_review(p.id, "dialogue", "back_to_scene")
        self._move(p, [S.DIALOGUE_REVIEW], S.SCENE_REVIEW)
        self.db.commit()
        return p

    def _check_dialogue_route(self, account: Account, config) -> str:
        """台词必须有办法传给视频模型：要么配置了台词字段，要么有「台词写法」模板把它拼进 prompt。
        两者都没有，台词会被悄悄丢掉，所以在创建时就报错。返回「台词写法」模板正文（可能为空）。"""
        line, _ = self.templates.resolve("video_dialogue", account)
        if not config.fields.dialogue and not line.strip():
            raise ValidationFailed(
                "台词没有传给视频模型的途径：请在「账号设置」里填台词字段名，或在「提示词模板」里创建「台词写法」模板")
        return line

    def _create_video_task(self, p: Production, content: dict) -> VideoTask:
        """用已审核的内容 + 数据库里该账号类型的模板，拼出最终提示词，创建视频任务（夜间模式只在窗口内提交）。"""
        account = self._account(p)
        config = load_config(account)
        option, _ = self.video.validate_params(config, p.resolution, p.duration_seconds, p.reference_file_ids or [])
        base, _ = self.templates.resolve("video_base", account)
        character, _ = self.templates.resolve("video_character", account)
        shot, _ = self.templates.resolve("video_shot", account)
        negative, _ = self.templates.resolve("video_negative", account)
        dialogue_line = self._check_dialogue_route(account, config)
        variables = {"aspect_ratio": option.aspect_ratio, "duration_seconds": str(p.duration_seconds)}
        prompt = assemble_video_prompt(base, character, shot, content, duration=p.duration_seconds,
                                       aspect_ratio=option.aspect_ratio, dialogue_line=dialogue_line)
        # 负向提示词也要一并发送：有负向字段就单独传，没有就按「负向写法」拼到 prompt 末尾
        prompt, negative_to_send = self.templates.with_negative(account, config, prompt, render(negative, variables))
        return self.video.create_for_production(
            production_id=p.id, account=account, prompt=prompt, negative_prompt=negative_to_send,
            # 有单独的台词字段才单独传；否则台词已经按「台词写法」模板写进 prompt
            dialogue=content["tts_text"] if config.fields.dialogue else None,
            image_ids=p.reference_file_ids or [], resolution=p.resolution, seed=p.seed,
            duration_seconds=p.duration_seconds, schedule_mode="window" if p.run_mode == "night" else "now",
        )

    # ---------- 审核 C：成片 ----------
    def approve_video(self, production_id: str) -> Production:
        p = self.get(production_id)
        self._require(p, S.VIDEO_REVIEW)
        self.repo.add_review(p.id, "video", "approve")
        self._move(p, [S.VIDEO_REVIEW], S.APPROVED)
        self.db.commit()
        return p

    def regenerate_video(self, production_id: str, req: RegenerateVideoRequest) -> Production:
        """重新生成会产生新一次 GPU 费用；旧视频任务保留作历史。"""
        p = self.get(production_id)
        self._require(p, S.VIDEO_REVIEW)
        scenes = [s.model_dump() for s in req.scenes] if req.scenes else None
        art = self._save_edit(p, {"scenes": scenes, "tts_text": req.tts_text})
        if req.run_mode:
            p.run_mode = req.run_mode
        # 内容不变时，同一个 seed 会得到几乎相同的视频；重新生成就换一个随机 seed
        old_seed, p.seed = p.seed, secrets.randbelow(900_000_000_000_000) + 100_000_000_000_000
        self.db.flush()
        self.repo.add_review(p.id, "video", "regenerate", comment=f"seed {old_seed} -> {p.seed}")
        task = self._create_video_task(p, art.content)
        self._move(p, [S.VIDEO_REVIEW], S.QUEUED, dict(video_task_id=task.id))
        self.db.commit()
        return p

    # ---------- 通用操作 ----------
    def discard(self, production_id: str, reason: str | None) -> Production:
        """随时废弃。若视频任务还在进行，停止跟踪它（外部 GPU 任务无法取消，可能仍会产生费用）。"""
        p = self.get(production_id)
        froms = [s for s in S if can_transition(s, S.DISCARDED)]
        self.repo.add_review(p.id, "production", "discard", comment=reason)
        self._move(p, froms, S.DISCARDED, dict(claimed_by=None, lease_expires_at=None))
        if p.video_task_id:
            self.tasks.transition(
                p.video_task_id, list(ACTIVE_STATUSES), TaskStatus.CANCELLED, event_type="task_cancelled",
                message="生产任务已废弃", values=dict(completed_at=utcnow(), claimed_by=None, lease_expires_at=None),
            )
        self.db.commit()
        return p

    def mark_published(self, production_id: str) -> Production:
        p = self.get(production_id)
        self._require(p, S.APPROVED)
        self.repo.add_review(p.id, "production", "published")
        self._move(p, [S.APPROVED], S.PUBLISHED)
        self.db.commit()
        return p

    def retry(self, production_id: str, confirm_duplicate: bool) -> Production:
        p = self.get(production_id)
        self._require(p, S.FAILED)
        clear = dict(failed_stage=None, error_message=None, pending_feedback=None)
        stage = p.failed_stage
        self.repo.add_review(p.id, stage or "production", "retry")
        if stage == "content":
            self._move(p, [S.FAILED], S.SCENE_GENERATING, clear)
        elif stage == "video" and p.video_task_id:
            self._move(p, [S.FAILED], S.QUEUED, clear)
            self.video.retry(p.video_task_id, confirm_duplicate)  # 内部提交事务，校验失败则抛错、不提交
            return self.get(p.id)
        else:
            raise StateConflict("无法确定失败阶段，请废弃后重新创建")
        self.db.commit()
        return p

    # ---------- 查询 ----------
    def _video_info(self, p: Production) -> VideoInfo | None:
        if not p.video_task_id:
            return None
        t = self.tasks.get(p.video_task_id)
        if not t:
            return None
        elapsed = None
        if t.started_at:
            elapsed = max(0, int(((t.completed_at or utcnow()) - t.started_at).total_seconds()))
        return VideoInfo(
            task_id=t.id, status=t.status, video_url=self.video._video_url(t), error_code=t.error_code,
            error_message=t.error_message, queue_position=self.tasks.queue_position(t), started_at=t.started_at,
            completed_at=t.completed_at, elapsed_seconds=elapsed, expected_start_at=self.video.expected_start_at(t),
        )

    def _item(self, p: Production) -> ProductionListItem:
        account = self.accounts.get(p.account_id)
        return ProductionListItem(
            id=p.id, account_id=p.account_id, account_name=account.name if account else None, topic=p.topic,
            run_mode=p.run_mode, status=p.status, needs_review=S(p.status) in REVIEW_STATUSES,
            duration_seconds=p.duration_seconds, resolution=p.resolution, created_at=p.created_at,
            updated_at=p.updated_at, video=self._video_info(p),
        )

    def list_page(self, **filters) -> ProductionList:
        items, total = self.repo.list_page(**filters)
        return ProductionList(items=[self._item(p) for p in items], page=filters["page"],
                              page_size=filters["page_size"], total=total)

    def detail(self, production_id: str) -> ProductionDetail:
        p = self.get(production_id)
        content = self.repo.current_artifact(p.id, "content")
        refs = [ReferenceImage(file_id=f.id, url=self.storage.get_url(f.storage_key))
                for i in (p.reference_file_ids or []) if (f := self.video.files.get(i))]
        return ProductionDetail(
            **self._item(p).model_dump(), seed=p.seed, failed_stage=p.failed_stage, error_message=p.error_message,
            allowed_actions=ALLOWED_ACTIONS[S(p.status)], content=_artifact_out(content) if content else None,
            history=[_artifact_out(a) for a in self.repo.list_artifacts(p.id)],
            reviews=[ReviewOut(stage=r.stage, action=r.action, comment=r.comment,
                               artifact_version=r.artifact_version, created_at=r.created_at)
                     for r in self.repo.list_reviews(p.id)],
            reference_images=refs,
        )
