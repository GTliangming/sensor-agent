"""生产流程 Worker：推进“LLM 阶段”，并把视频任务状态同步回生产流程。

- 生成内容（主题、台词、字幕、分镜）：领取 scene_generating 状态的生产，调用 LLM，成功后停在审核状态等人处理；
- 同步：queued/generating 的生产跟随其视频任务的状态变化（成功后进入成片审核）。

所有状态变更都是条件更新：人工在 LLM 生成期间点了废弃/退回，这次结果会被丢弃。
独立运行：python -m app.workers.runner（同时运行视频 Worker 和本 Worker）
"""
import asyncio
import logging
import uuid

from app.core.config import Settings
from app.core.exceptions import ValidationFailed
from app.core.logging import redact
from app.db.session import SessionLocal
from app.domain.production_status import ProductionStatus as S
from app.domain.status import TaskStatus
from app.llm.base import LLMClient, LLMError
from app.models import Production
from app.pipeline.nodes import NodeResult, build_revision_notes, generate_content
from app.pipeline.render import render
from app.repositories.account_repository import AccountRepository
from app.repositories.production_repository import ProductionRepository
from app.repositories.video_task_repository import VideoTaskRepository
from app.services.account_service import load_config
from app.services.template_service import TemplateService

logger = logging.getLogger("pipeline_worker")

# 视频任务状态 -> 生产状态
_TASK_TO_PRODUCTION = {
    TaskStatus.PENDING.value: S.QUEUED,
    TaskStatus.SUBMITTED.value: S.GENERATING,
    TaskStatus.RUNNING.value: S.GENERATING,
    TaskStatus.SUCCEEDED.value: S.VIDEO_REVIEW,
}


class PipelineWorker:
    def __init__(self, settings: Settings, llm: LLMClient) -> None:
        self.s, self.llm = settings, llm
        self.worker_id = f"pipeline-{uuid.uuid4().hex[:8]}"

    async def run_forever(self, stop: asyncio.Event | None = None) -> None:
        logger.info("pipeline worker started id=%s llm=%s", self.worker_id, self.llm.name)
        while not (stop and stop.is_set()):
            try:
                worked = await self.run_once()
            except Exception:
                logger.exception("pipeline loop error")
                worked = False
            if not worked:
                await asyncio.sleep(self.s.worker_idle_sleep_seconds)

    async def run_once(self) -> bool:
        worked = self.sync_generation()
        with SessionLocal() as db:
            repo = ProductionRepository(db)
            p = repo.claim_next(self.worker_id, self.s.pipeline_lease_seconds)
            if not p:
                return worked
            try:
                await self._generate(db, repo, p)
            except Exception as e:  # 未预期异常：标记失败让人看到，而不是卡在租约里
                db.rollback()
                logger.exception("production %s unexpected error", p.id)
                self._fail(db, repo, p, f"内部错误: {type(e).__name__}")
            return True

    # ---------- 同步视频任务状态 ----------
    def sync_generation(self) -> bool:
        changed = False
        with SessionLocal() as db:
            repo, tasks = ProductionRepository(db), VideoTaskRepository(db)
            for p in repo.list_syncable():
                task = tasks.get(p.video_task_id)
                if not task:
                    continue
                if task.status in (TaskStatus.FAILED.value, TaskStatus.CANCELLED.value):
                    msg = task.error_message or "视频任务已取消"
                    ok = repo.transition(p.id, [S.QUEUED, S.GENERATING], S.FAILED,
                                         dict(failed_stage="video", error_message=msg[:1000]))
                else:
                    target = _TASK_TO_PRODUCTION[task.status]
                    if target.value == p.status:
                        continue
                    ok = repo.transition(p.id, [S.QUEUED, S.GENERATING], target)
                changed = changed or ok
            db.commit()
        return changed

    # ---------- LLM 阶段：一次生成主题、台词、字幕、分镜 ----------
    async def _generate(self, db, repo: ProductionRepository, p: Production) -> None:
        account = AccountRepository(db).get(p.account_id)
        if not account:
            self._fail(db, repo, p, "账号类型不存在")
            return
        feedback = p.pending_feedback  # 先取出：后面的条件更新会把它清空（并同步到内存对象）
        previous = repo.current_artifact(p.id, "content")
        # 提示词和生成配置全部从数据库按“业务线 + 账号类型”取；缺了就明确失败，不用代码里的默认文本
        try:
            templates = TemplateService(db)
            system_body, template_id = templates.resolve("content", account)
            user_body, _ = templates.resolve("content_user", account)
            option = load_config(account).resolution(p.resolution)
        except ValidationFailed as e:
            self._fail(db, repo, p, e.message)
            return
        common = {
            "account_name": account.name, "persona": account.persona,
            "style_guide": account.style_guide or "无特别要求",
            "duration_seconds": str(p.duration_seconds), "aspect_ratio": option.aspect_ratio if option else "",
        }
        system = render(system_body, common)
        # 只有“带修改意见的重新生成”才带上一版，首次生成为空
        notes = build_revision_notes(previous.content if previous else None, feedback)
        user = render(user_body, {**common, "topic": p.topic, "revision_notes": notes})

        result: NodeResult | None = None
        error: LLMError | None = None
        for attempt in range(self.s.llm_max_retries + 1):
            try:
                result = await generate_content(self.llm, system, user)
                break
            except LLMError as e:
                error = e
                if not e.retryable or attempt >= self.s.llm_max_retries:
                    break
                await asyncio.sleep(2 ** attempt)
        if result is None:
            msg = redact(error.message if error else "未知错误", [self.s.deepseek_api_key])
            self._fail(db, repo, p, msg, code=error.code if error else None)
            return

        values = dict(pending_feedback=None, claimed_by=None, lease_expires_at=None)
        if not p.topic and result.content.get("theme"):
            values["topic"] = result.content["theme"]  # 自动选题：回填大模型给出的主题
        ok = repo.transition(p.id, [S.SCENE_GENERATING], S.SCENE_REVIEW, values)
        if ok:  # 状态仍是生成中才保存；否则说明期间被废弃，丢弃这次结果
            repo.add_artifact(p.id, "content", result.content, "llm", template_id=template_id,
                              rendered_prompt=result.rendered_prompt, feedback=feedback)
        db.commit()
        logger.info("production %s content generated applied=%s", p.id, ok)

    def _fail(self, db, repo: ProductionRepository, p: Production, message: str, code: str | None = None) -> None:
        text = f"{code}: {message}" if code else message
        repo.transition(p.id, [S.SCENE_GENERATING], S.FAILED,
                        dict(failed_stage="content", error_message=text[:1000], claimed_by=None, lease_expires_at=None))
        db.commit()
