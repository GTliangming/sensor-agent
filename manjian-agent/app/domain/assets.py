"""素材领域对象与版权元数据（文档 02.3 / 06.4）。

核心规则：授权状态未知 = 不可用于商业发布，而不是默认可用。
无权使用的素材应在检索阶段先被过滤，不能因为语义匹配高而进入候选结果。
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field

AssetType = Literal["image", "video", "audio"]
SourceType = Literal["owned", "licensed", "generated"]


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


class Asset(BaseModel):
    asset_id: str
    asset_type: AssetType = "image"
    source_type: SourceType = "licensed"
    source_name: str = ""
    source_url: str = ""
    local_path: str = ""

    # 版权元数据（文档 06.4 最低要求）
    license_type: str = ""
    commercial_use_allowed: bool = False
    attribution_required: bool = False
    license_evidence_url: str = ""
    license_checked_at: str = ""
    content_hash: str = ""

    # 媒体与检索元数据
    duration: float | None = None
    aspect_ratio: str = ""  # 如 "9:16"
    tags: list[str] = Field(default_factory=list)
    mood: str = "neutral"
    quality_score: float = Field(default=0.5, ge=0, le=1)
    usage_count: int = Field(default=0, ge=0)
    last_used_at: str | None = None
    created_at: str = Field(default_factory=_now_iso)

    @property
    def is_commercially_usable(self) -> bool:
        """是否可进入"可商用素材"候选池。

        - generated（AI 生成）在补图阶段单独处理，这里只认 owned / licensed；
        - 必须显式 commercial_use_allowed=True；
        - licensed 还必须有授权证据 license_evidence_url；
        - owned 视为自有可用（仍要求 commercial_use_allowed，避免误标）。
        """
        if not self.commercial_use_allowed:
            return False
        if self.source_type == "owned":
            return True
        if self.source_type == "licensed":
            return bool(self.license_evidence_url.strip())
        return False
