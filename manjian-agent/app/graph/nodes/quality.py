"""质检 Agent + Supervisor（文档 04/05，阶段 6）。

- quality_check：确定性检查结构/授权/产物，产出 QualityReport 与问题类型。
- supervisor：代码路由优先，只返回受控枚举 RouteDecision；预算/状态/次数由代码强制，
  绝不绕过授权与预算，返工有次数上限。
"""
from __future__ import annotations

from app.config import Settings
from app.domain.plans import QualityReport
from app.domain.storyboard import Storyboard
from app.graph.routing import RouteDecision
from app.graph.state import AgentState, Stage, TaskStatus
from app.observability.logging import get_logger

logger = get_logger(__name__)


def _issue_type(state: AgentState) -> str | None:
    """返回首要问题类型：storyboard / asset / technical / None(通过)。"""
    if not state.get("storyboard"):
        return "storyboard"
    sb = Storyboard.model_validate(state["storyboard"])
    if not sb.scenes:
        return "storyboard"
    ap = state.get("asset_plan") or {}
    # 授权红线：被选中的素材里若出现无授权样本（防御性），判 asset 问题
    if any(m.get("chosen_asset_id", "").startswith("img_unknown") for m in ap.get("scene_matches", [])):
        return "asset"
    rp = state.get("render_plan") or {}
    if not rp.get("validated"):
        return "technical"
    return None


async def quality_check(state: AgentState) -> dict:
    issue = _issue_type(state)
    checks = [
        {"name": "storyboard_present", "ok": bool(state.get("storyboard"))},
        {"name": "render_validated", "ok": bool((state.get("render_plan") or {}).get("validated"))},
        {"name": "no_unlicensed_asset", "ok": issue != "asset"},
    ]
    report = QualityReport(task_id=state["task_id"], producer="quality_agent",
                           passed=issue is None, checks=checks)
    logger.info("quality_check task=%s passed=%s issue=%s", state["task_id"], report.passed, issue)
    return {"stage": Stage.VALIDATING, "quality_report": report.model_dump()}


def make_supervisor(settings: Settings):
    """代码优先的有限路由：读 QualityReport + 次数上限，产出枚举决策。"""
    def supervisor(state: AgentState) -> dict:
        issue = _issue_type(state)
        counts = dict(state.get("retry_counts", {}))
        if issue is None:
            decision = RouteDecision.CONTINUE
        elif issue == "storyboard" and counts.get("storyboard", 0) < settings.max_storyboard_revisions:
            counts["storyboard"] = counts.get("storyboard", 0) + 1
            decision = RouteDecision.REVISE_STORYBOARD
        elif issue == "asset" and counts.get("asset", 0) < settings.max_asset_rechecks:
            counts["asset"] = counts.get("asset", 0) + 1
            decision = RouteDecision.RETRY_ASSET_SEARCH
        else:
            decision = RouteDecision.FAIL
        out: dict = {"route_decision": str(decision), "retry_counts": counts}
        if decision == RouteDecision.FAIL:
            out["status"] = TaskStatus.FAILED
            out["errors"] = [{"code": "quality_failed", "message": f"质检未通过且无法返工: {issue}"}]
        logger.info("supervisor task=%s issue=%s decision=%s counts=%s",
                    state["task_id"], issue, decision, counts)
        return out

    return supervisor


# 路由目标白名单（Supervisor 只能命中这些；非法决策一律 FAIL）
_ROUTE_TARGETS = {
    RouteDecision.CONTINUE: "validate_output",
    RouteDecision.REVISE_STORYBOARD: "generate_storyboard",
    RouteDecision.RETRY_ASSET_SEARCH: "retrieve_assets",
    RouteDecision.FAIL: "save_result",
}


def route_from_supervisor(state: AgentState) -> str:
    raw = state.get("route_decision")
    try:
        decision = RouteDecision(raw)
    except ValueError:
        logger.warning("非法路由决策被拒绝: %r -> FAIL", raw)
        return "save_result"
    return _ROUTE_TARGETS[decision]
