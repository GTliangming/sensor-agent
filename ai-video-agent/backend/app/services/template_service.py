"""提示词模板业务逻辑：创建、版本化更新、按作用域匹配。"""
import uuid

from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError, ValidationFailed
from app.models import Account, PromptTemplate
from app.pipeline.default_templates import KIND_LABELS, OPTIONAL_KINDS, REQUIRED_KINDS
from app.pipeline.render import render, unknown_variables
from app.repositories.account_repository import AccountRepository
from app.repositories.template_repository import TemplateRepository
from app.schemas.template import TemplateCreate, TemplateUpdate


# 各作用域的匹配权重：账号类型专属 > 视频类型 > 业务线。权重互不叠加覆盖，保证优先级严格成立。
_W_ACCOUNT, _W_VIDEO_TYPE, _W_PLATFORM = 100, 10, 1


def pick_template(candidates: list[PromptTemplate], account: Account, video_type: str) -> PromptTemplate | None:
    """纯函数：从候选里选出最匹配的模板。不匹配的作用域（指定了别的账号/类型）直接排除。"""
    best: tuple[int, int, PromptTemplate] | None = None
    for t in candidates:
        score = 0
        if t.account_id:
            if t.account_id != account.id:
                continue
            score += _W_ACCOUNT
        if t.video_type:
            if t.video_type != video_type:
                continue
            score += _W_VIDEO_TYPE
        if t.platform:
            if t.platform != account.platform:
                continue
            score += _W_PLATFORM
        key = (score, t.version)
        if best is None or key > (best[0], best[1]):
            best = (score, t.version, t)
    return best[2] if best else None


class TemplateService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repo = TemplateRepository(db)

    @staticmethod
    def _check_body(body: str) -> None:
        bad = unknown_variables(body)
        if bad:
            raise ValidationFailed(f"模板包含未知变量: {', '.join('{{' + v + '}}' for v in bad)}")

    def create(self, req: TemplateCreate) -> PromptTemplate:
        self._check_body(req.body)
        gid = str(uuid.uuid4())
        t = PromptTemplate(id=str(uuid.uuid4()), group_id=gid, version=1, **req.model_dump())
        self.repo.add(t)
        self.db.commit()
        return t

    def update(self, template_id: str, req: TemplateUpdate) -> PromptTemplate:
        old = self.get(template_id)
        self._check_body(req.body)
        latest = self.repo.list_versions(old.group_id)[0]
        self.repo.deactivate_group(old.group_id)
        new = PromptTemplate(
            id=str(uuid.uuid4()), group_id=old.group_id, version=latest.version + 1, kind=old.kind, **req.model_dump(),
        )
        self.repo.add(new)
        self.db.commit()
        return new

    def deactivate(self, template_id: str) -> None:
        self.repo.deactivate_group(self.get(template_id).group_id)
        self.db.commit()

    def get(self, template_id: str) -> PromptTemplate:
        t = self.repo.get(template_id)
        if not t:
            raise NotFoundError("模板不存在", {"template_id": template_id})
        return t

    def list_for(self, kind: str | None = None, account_id: str | None = None) -> list[PromptTemplate]:
        """给定账号类型时，返回对它生效的模板：该账号类型专属、所在业务线通用、全局通用。"""
        items = self.repo.list_active(kind)
        if account_id:
            account = AccountRepository(self.db).get(account_id)
            if not account:
                raise NotFoundError("账号类型不存在", {"account_id": account_id})
            items = [t for t in items
                     if t.account_id in (None, account.id) and t.platform in (None, account.platform)]
        return items

    def resolve(self, kind: str, account: Account, video_type: str = "general") -> tuple[str, str | None]:
        """从数据库取模板正文，返回 (正文, 模板 id)。

        找不到就报错（可选种类返回空文本），不会悄悄回退到代码里的默认文本——
        否则漏配的模板会被掩盖，生成出来的内容和你以为的不一样。
        """
        picked = pick_template(self.repo.list_active(kind), account, video_type)
        if picked:
            return picked.body, picked.id
        if kind in OPTIONAL_KINDS:
            return "", None
        raise ValidationFailed(
            f"账号类型「{account.name}」缺少「{KIND_LABELS.get(kind, kind)}」模板，请到「提示词模板」里创建",
            {"kind": kind, "account_id": account.id},
        )

    def missing_kinds(self, account: Account) -> list[str]:
        return [k for k in REQUIRED_KINDS if pick_template(self.repo.list_active(k), account, "general") is None]

    def require_complete(self, account: Account) -> None:
        """创建生产任务前检查：必需的模板是否齐全，缺哪些一次说清楚。"""
        missing = self.missing_kinds(account)
        if missing:
            names = "、".join(KIND_LABELS[k] for k in missing)
            raise ValidationFailed(f"账号类型「{account.name}」缺少模板：{names}。请到「提示词模板」里创建。",
                                   {"missing": missing})

    def with_negative(self, account: Account, config, prompt: str, negative: str | None) -> tuple[str, str | None]:
        """决定负向提示词怎么传给视频模型，返回 (最终 prompt, 单独发送的负向提示词)。

        H3 工作流只有一个 prompt 字段：
        - 账号设置里配置了负向提示词字段 -> 单独发送，prompt 不变；
        - 没有配置 -> 按「负向写法」模板拼到 prompt 末尾一起发送。
        两种途径都没有时报错，不会悄悄丢掉负向提示词。
        """
        negative = (negative or "").strip()
        if not negative:
            return prompt, None
        if config.fields.negative_prompt:
            return prompt, negative
        line, _ = self.resolve("video_negative_line", account)
        if not line.strip():
            raise ValidationFailed(
                "负向提示词没有传给视频模型的途径：请在「账号设置」里填负向提示词字段名，"
                "或在「提示词模板」里创建「负向写法」模板")
        return f"{prompt} {render(line, {'negative_prompt': negative})}".strip(), None
