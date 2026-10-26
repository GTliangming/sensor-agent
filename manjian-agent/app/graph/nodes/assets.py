"""素材检索 + AI 补图节点（文档 06 / 07，阶段 2-3）。

retrieve_assets：按授权优先 + 可解释打分，为每个场景匹配授权素材，产出 AssetPlan。
plan_missing_assets：对缺口场景按预算（max_generated_images）规划补图清单。
generate_missing_images：只对预算内缺口生成图片（带缓存、文件校验），把生成资产回填到 AssetPlan。
"""
from __future__ import annotations

from app.domain.assets import Asset
from app.domain.plans import AssetPlan
from app.domain.request import CreateTaskRequest
from app.domain.storyboard import Storyboard
from app.graph.state import AgentState, Stage
from app.observability.logging import get_logger
from app.repositories.sqlite import TaskRepository
from app.services.assets.asset_retrieval import AssetRetriever
from app.services.assets.image_generation import ImageGenerationService

logger = get_logger(__name__)


def make_retrieve_assets(repo: TaskRepository):
    async def retrieve_assets(state: AgentState) -> dict:
        request = CreateTaskRequest.model_validate(state["request"])
        storyboard = Storyboard.model_validate(state["storyboard"])
        assets = [Asset.model_validate(a) for a in repo.list_assets("image")]

        plan = AssetRetriever(assets).match(storyboard, request, state["task_id"])
        logger.info(
            "asset retrieval task=%s hit=%s/%s pool=%s excluded_unlicensed=%s",
            state["task_id"], plan.stats["hit_count"], plan.stats["scene_count"],
            plan.stats["pool_size"], plan.stats["excluded_unlicensed"],
        )
        return {"stage": Stage.ASSET_SEARCH, "asset_plan": plan.model_dump()}

    return retrieve_assets


async def plan_missing_assets(state: AgentState) -> dict:
    request = CreateTaskRequest.model_validate(state["request"])
    plan = AssetPlan.model_validate(state["asset_plan"])

    budget = request.max_generated_images
    to_generate = plan.gaps[:budget]
    over_budget = plan.gaps[budget:]

    plan.stats["to_generate"] = to_generate
    plan.stats["over_budget_unfulfilled"] = over_budget
    plan.stats["generation_budget"] = budget
    if over_budget:
        plan.warnings.append(
            f"{len(over_budget)} 个缺口场景超过补图预算（max_generated_images={budget}），暂不生成"
        )
    logger.info(
        "plan missing assets task=%s gaps=%s to_generate=%s over_budget=%s",
        state["task_id"], len(plan.gaps), len(to_generate), len(over_budget),
    )
    return {"stage": Stage.ASSET_SEARCH, "asset_plan": plan.model_dump()}


def make_generate_missing_images(service: ImageGenerationService):
    async def generate_missing_images(state: AgentState) -> dict:
        plan_dict = state.get("asset_plan")
        to_generate = (plan_dict or {}).get("stats", {}).get("to_generate", [])
        if not plan_dict or not to_generate:
            logger.info("无缺口需补图 task=%s", state["task_id"])
            return {"stage": Stage.IMAGE_GENERATION}

        storyboard = Storyboard.model_validate(state["storyboard"])
        request = CreateTaskRequest.model_validate(state["request"])
        plan = AssetPlan.model_validate(plan_dict)
        updated = await service.fill_gaps(storyboard, request, plan)
        return {"stage": Stage.IMAGE_GENERATION, "asset_plan": updated.model_dump()}

    return generate_missing_images
