"""业务线与账号类型业务逻辑。"""
import copy
import uuid

from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError, ValidationFailed
from app.domain.generation_config import GenerationConfig
from app.llm.base import LLMClient, LLMError
from app.models import Account, PromptTemplate
from app.pipeline.nodes import suggest_topic
from app.pipeline.render import render
from app.repositories.account_repository import AccountRepository
from app.repositories.production_repository import ProductionRepository
from app.repositories.template_repository import TemplateRepository
from app.schemas.account import AccountTypeCreate, AccountTypeOut, AccountTypeUpdate, BusinessLineOut
from app.services.template_service import TemplateService


def to_out(a: Account) -> AccountTypeOut:
    return AccountTypeOut.model_validate(a, from_attributes=True)


def parse_config(params: dict) -> GenerationConfig:
    """校验账号类型的生成配置；出错时把原因翻译成能看懂的提示。"""
    try:
        return GenerationConfig.model_validate(params or {})
    except ValidationError as e:
        problems = "；".join(f"{'.'.join(str(p) for p in err['loc'])}: {err['msg']}" for err in e.errors())
        raise ValidationFailed(f"生成配置不合法：{problems}") from e


def load_config(account: Account) -> GenerationConfig:
    """生成时从数据库取账号类型的配置（seed、视频方向、时长/图片上限、AutoDL 工作流与字段名）。"""
    return parse_config(account.params)


class AccountService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repo = AccountRepository(db)

    def business_lines(self) -> list[BusinessLineOut]:
        """业务线及其下的账号类型（含生成配置），前端据此渲染导航和创建表单。"""
        types = self.repo.list_all()
        return [
            BusinessLineOut(key=bl.key, name=bl.name,
                            account_types=[to_out(a) for a in types if a.platform == bl.key])
            for bl in self.repo.list_business_lines()
        ]

    def get(self, account_id: str) -> Account:
        account = self.repo.get(account_id)
        if not account:
            raise NotFoundError("账号类型不存在", {"account_id": account_id})
        return account

    def create(self, body: AccountTypeCreate) -> Account:
        """新建账号类型。copy_from 给定时复制那个类型的生成配置和全部专属模板，只需再改改。"""
        if not self.repo.get_business_line(body.platform):
            raise ValidationFailed(f"未知的业务线: {body.platform}")
        if self.repo.get_by_slug(body.platform, body.slug):
            raise ValidationFailed("该业务线下已存在相同标识的账号类型")
        source = self.get(body.copy_from) if body.copy_from else None
        params = copy.deepcopy(source.params) if source and not body.params else body.params
        parse_config(params)
        account = Account(
            id=str(uuid.uuid4()), slug=body.slug, name=body.name, platform=body.platform, persona=body.persona,
            style_guide=body.style_guide, workflow_key=source.workflow_key if source else body.workflow_key,
            params=params,
        )
        self.repo.add(account)
        if source:
            self._copy_templates(source, account)
        self.db.commit()
        return account

    def _copy_templates(self, source: Account, target: Account) -> None:
        repo = TemplateRepository(self.db)
        for t in repo.list_active():
            if t.account_id == source.id:
                repo.add(PromptTemplate(
                    id=str(uuid.uuid4()), group_id=str(uuid.uuid4()), version=1, kind=t.kind, name=t.name,
                    account_id=target.id, video_type=t.video_type, platform=t.platform, body=t.body,
                ))

    def update(self, account_id: str, body: AccountTypeUpdate) -> Account:
        account = self.get(account_id)
        parse_config(body.params)
        for k, v in body.model_dump().items():
            setattr(account, k, v)
        self.db.commit()
        return account

    async def suggest_topic(self, account_id: str, llm: LLMClient) -> str:
        """让大模型想一个新主题；提示词来自数据库里该账号类型的 topic_suggest 模板。"""
        account = self.get(account_id)
        body, _ = TemplateService(self.db).resolve("topic_suggest", account)
        if not body.strip():
            raise ValidationFailed("这个账号类型还没有「AI 想主题」模板，请到「提示词模板」里创建")
        recent = ProductionRepository(self.db).recent_topics(account.id, 10)
        system = render(body, {
            "account_name": account.name, "persona": account.persona, "style_guide": account.style_guide or "无特别要求",
            "recent_topics": "、".join(recent) if recent else "无",
        })
        try:
            return await suggest_topic(llm, system)
        except LLMError as e:
            raise ValidationFailed(f"主题生成失败：{e.message}") from e
