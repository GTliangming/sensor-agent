"""提示词模板管理。修改模板 = 新增版本。"""
from fastapi import APIRouter, Depends, Query

from app.api.deps import get_template_service
from app.pipeline.default_templates import KIND_LABELS, REQUIRED_KINDS, STARTER_BODIES
from app.pipeline.render import VARIABLES
from app.schemas.common import ApiResponse, ok
from app.schemas.template import TemplateCreate, TemplateMeta, TemplateOut, TemplateUpdate
from app.services.template_service import TemplateService

router = APIRouter(prefix="/templates", tags=["templates"])


def _out(t) -> TemplateOut:
    return TemplateOut.model_validate(t, from_attributes=True)


@router.get("/meta", response_model=ApiResponse[TemplateMeta])
def template_meta() -> dict:
    """模板种类、可用变量与起步文本，供编辑器提示。"""
    return ok(TemplateMeta(variables=VARIABLES, kinds=KIND_LABELS, required=REQUIRED_KINDS, starters=STARTER_BODIES))


@router.get("", response_model=ApiResponse[list[TemplateOut]])
def list_templates(kind: str | None = Query(None, pattern="^(content|content_user|topic_suggest|video_base|video_character|video_shot|video_dialogue|video_negative|video_negative_line)$"),
                   account_id: str | None = None,
                   svc: TemplateService = Depends(get_template_service)) -> dict:
    return ok([_out(t) for t in svc.list_for(kind, account_id)])


@router.post("", response_model=ApiResponse[TemplateOut], status_code=201)
def create_template(body: TemplateCreate, svc: TemplateService = Depends(get_template_service)) -> dict:
    return ok(_out(svc.create(body)), "模板已创建")


@router.put("/{template_id}", response_model=ApiResponse[TemplateOut])
def update_template(template_id: str, body: TemplateUpdate, svc: TemplateService = Depends(get_template_service)) -> dict:
    return ok(_out(svc.update(template_id, body)), "已保存为新版本")


@router.delete("/{template_id}", response_model=ApiResponse[None])
def deactivate_template(template_id: str, svc: TemplateService = Depends(get_template_service)) -> dict:
    """停用模板（保留历史版本，已产出的内容仍能追溯）。"""
    svc.deactivate(template_id)
    return ok(None, "已停用")
