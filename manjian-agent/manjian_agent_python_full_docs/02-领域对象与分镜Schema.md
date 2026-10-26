# 02 领域对象与分镜 Schema

## 1. 任务输入

建议输入模型（示意，最终字段应由业务合同确定）：

```python
from pydantic import BaseModel, Field
from typing import Literal

class CreateTaskRequest(BaseModel):
    request_id: str = Field(min_length=1, max_length=128)
    topic: str = Field(min_length=1, max_length=300)
    style: str = Field(default="现代、温柔清冷", max_length=100)
    target_seconds: int = Field(default=15, ge=5, le=60)
    language: Literal["zh-CN"] = "zh-CN"
    material_policy: Literal["licensed_first_ai_fallback"] = "licensed_first_ai_fallback"
    max_scenes: int = Field(default=8, ge=1, le=20)
    max_generated_images: int = Field(default=6, ge=0, le=12)
```

注意：这里的 `request_id` 是幂等键示意，不是用户身份凭证。身份与积分由上游负责。

## 2. 分镜输出

```python
from pydantic import BaseModel, Field, model_validator

class Scene(BaseModel):
    scene_id: str
    order: int = Field(ge=1)
    narration: str = Field(min_length=1, max_length=500)
    visual_prompt: str = Field(min_length=1, max_length=1000)
    duration_seconds: float = Field(gt=0, le=15)
    mood: str = "neutral"
    tags: list[str] = []
    needs_character_consistency: bool = True

class Storyboard(BaseModel):
    title: str
    hook: str
    closing_line: str
    scenes: list[Scene] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def validate_order_and_duration(self):
        orders = [scene.order for scene in self.scenes]
        if orders != list(range(1, len(self.scenes) + 1)):
            raise ValueError("scene order must be continuous and start at 1")
        if len({scene.scene_id for scene in self.scenes}) != len(self.scenes):
            raise ValueError("scene_id must be unique")
        return self
```

项目中不要直接信任模型生成的 `duration_seconds` 总和。后端必须校验总时长，并根据目标时长进行确定性修正或返回可解释错误。Python mutable defaults 应使用 `Field(default_factory=list)`；上面代码是结构示意，实际代码应采用 `default_factory`。

## 3. 素材引用对象

每个素材引用都应包含：
- `asset_id`
- `asset_type`: image / video / audio
- `source_type`: owned / licensed / generated
- `source_url` 或本地存储位置
- `license_type`
- `commercial_use_allowed`
- `attribution_required`
- `license_evidence`
- `content_hash`
- `duration`（视频/音频）
- `tags`、`mood`、`aspect_ratio`
- `created_at`

没有明确授权证据的素材，不应进入“可商用素材”候选池。

## 4. Agent 之间传什么

Agent 不应靠自然语言长段聊天传递状态。交接对象要有 schema：

- `CreativeBrief`: 主题、受众、风格、时长、禁用元素。
- `Storyboard`: 场景顺序、旁白、画面提示词、时长。
- `AssetPlan`: 每个场景的候选素材、缺口、授权状态、生成建议。
- `AudioPlan`: TTS 文本、音色配置、语速、片段顺序。
- `RenderPlan`: 素材路径、音频路径、字幕路径、转场、输出规格。
- `QualityReport`: 检查项、错误、警告、是否允许继续。

每个交接都应包含 `task_id`、`schema_version`、`producer` 和 `created_at`，便于审计与兼容升级。
