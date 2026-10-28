"""账号类型的生成配置（存在 accounts.params 里，后台可改）。

视频方向选项、时长上限、参考图/音频上限、seed、AutoDL 工作流 ID 和请求字段名，
都跟着“业务线 + 账号类型”走，保存在数据库里；生成时查库，不写在代码里。
这里只定义结构与校验，出厂值见 app/seed.py。
"""
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class ResolutionOption(BaseModel):
    """“视频方向”选项。values 是平台工作流里对应的节点参数，原样保存备查。"""

    label: str = Field(min_length=1, max_length=32)
    aspect_ratio: str = Field(min_length=1, max_length=16)  # 如 9:16，用于模板变量与播放器比例
    megapixels: float = 0
    values: dict = Field(default_factory=dict)


class FieldMapping(BaseModel):
    """AutoDL 请求体里各参数的字段名；留空表示该参数不传。

    参考图/参考音频是“编号字段”：这里填前缀，第 N 个文件写进 前缀+N（从 0 开始），
    例如 images="ref_image_" 会得到 ref_image_0、ref_image_1……（官方文档里值是文件的 URL）。
    """

    prompt: str = "prompt"
    duration: str = "duration"
    resolution: str = "resolution"  # 传视频方向的标签，如 480p竖
    seed: str = "seed"
    negative_prompt: str = ""  # 当前 H3 工作流没有这个参数；留空则按「负向写法」模板拼进 prompt
    dialogue: str = ""  # 留空时台词通过「台词写法」模板拼进 prompt
    images: str = ""  # 参考图编号字段的前缀
    audios: str = ""  # 参考音频编号字段的前缀（暂未开放）
    image_mode: Literal["base64", "url"] = "url"  # url：传可公网访问的图片地址；base64：传图片内容


class GenerationConfig(BaseModel):
    config_version: int = 1  # 出厂配置的版本号，升级时用来判断是否需要补上新的出厂值
    workflow_id: str = ""  # AutoDL 工作流 ID
    seed: int | None = Field(default=None, ge=0)
    min_duration: int = Field(default=1, ge=1)
    max_duration: int = Field(default=15, ge=1)
    default_duration: int = Field(default=15, ge=1)
    max_images: int = Field(default=8, ge=0, le=16)
    max_audios: int = Field(default=3, ge=0, le=16)
    audio_enabled: bool = False  # 参考音频暂未开放
    requires_image: bool = False
    resolutions: list[ResolutionOption] = Field(min_length=1)
    default_resolution: str | None = None
    fields: FieldMapping = Field(default_factory=FieldMapping)
    video_config: dict = Field(default_factory=dict)  # 原提示词方案里的分辨率/帧率等，备查

    @model_validator(mode="after")
    def _check(self) -> "GenerationConfig":
        if not self.min_duration <= self.default_duration <= self.max_duration:
            raise ValueError("时长需满足 最短 <= 默认 <= 最长")
        labels = [r.label for r in self.resolutions]
        if len(set(labels)) != len(labels):
            raise ValueError("视频方向的名称不能重复")
        if self.default_resolution and self.default_resolution not in labels:
            raise ValueError("默认视频方向必须是已有的选项")
        return self

    def resolution(self, label: str | None) -> ResolutionOption | None:
        """按标签取视频方向；不传则用默认项，没有默认项取第一项。"""
        if not label:
            label = self.default_resolution
        if not label:
            return self.resolutions[0]
        return next((r for r in self.resolutions if r.label == label), None)
