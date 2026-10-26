# 漫剪师 Agent Python 服务端：完整实施文档（含多 Agent 方案）

# 漫剪师 Agent Python 服务端：完整实施文档（含多 Agent 方案）

> 范围：只覆盖 Python Agent 服务端。Go 侧鉴权、用户权限、积分扣减、对外网关不在本项目实现范围内。本文是设计与开发手册，不是已经完成并验证的代码仓库。

## 阅读顺序

1. `00-项目范围与总体路线.md`：系统边界、阶段路线与交付物。
2. `01-模型选型与成本控制.md`：文本模型、图像模型、TTS、FFmpeg 的职责。
3. `02-领域对象与分镜Schema.md`：稳定的数据契约。
4. `03-单Agent工作流.md`：先把可运行的主链路跑通。
5. `04-多Agent架构与协作协议.md`：多 Agent 角色、边界、交接规则。
6. `05-LangGraph多Agent图设计.md`：Supervisor、子图、状态和路由设计。
7. `06-素材检索与版权元数据.md`：先检索授权素材，缺失时才生成。
8. `07-AI补图与供应商适配器.md`：图像生成、重试、缓存。
9. `08-TTS与FFmpeg合成.md`：配音、字幕、渲染。
10. `09-任务API与持久化.md`：异步任务、状态机、幂等与恢复。
11. `10-可观测性、安全与错误处理.md`：日志、追踪、限流、合规。
12. `11-测试验收与项目目录.md`：测试策略、目录结构、验收标准。
13. `12-分阶段实施清单.md`：按可验证的小步落地。

## 核心原则

- 第一版不是“必须多 Agent”。先用单一 LangGraph 主流程验证业务链路，再把边界稳定的能力拆成节点/子图/Agent。
- 本文同时给出单 Agent 和多 Agent 两套设计。多 Agent 是可选的编排升级，不代表所有角色都必须独立调用大模型。
- LLM 负责创意、结构化分镜、语义判断；普通代码负责权限边界、状态机、重试、预算、文件检查、FFmpeg、幂等和持久化。
- 素材优先级：可验证授权的现有素材 > 自有素材 > AI 生成素材。不要把“能下载”当作“可商用”。
- 先用 SQLite + 本地文件目录开发；有并发和部署需求后再迁移数据库、对象存储和队列。
- 不要一开始就上向量数据库、视频生成模型、复杂多 Agent 群聊。先建立质量指标和成本基线。


---

# 00 项目范围与总体路线

## 1. 本项目负责什么

Python Agent 服务端接收已经由上游服务完成身份校验的任务请求，负责：

1. 解析创作目标和用户偏好。
2. 生成文案、旁白和分镜。
3. 搜索已有且授权状态明确的素材。
4. 对素材缺口生成 AI 图片或选择可替代素材。
5. 生成语音和字幕。
6. 调用 FFmpeg 合成视频。
7. 记录任务进度、产物、成本、错误和可恢复节点。

不负责：登录、用户鉴权、权限校验、积分扣减、支付、Go 网关、前端页面。上游应传入经过验证的 `request_id`、业务用户标识（如有必要）和允许使用的能力范围；Python 不能因为请求体中出现某个 user_id 就默认信任它。

## 2. 推荐技术栈

- Python 3.12
- FastAPI：内部 HTTP API
- Pydantic 2：输入输出和 LLM 结构校验
- LangGraph：流程编排、状态与检查点
- SQLite：开发阶段任务、分镜、素材引用和运行记录
- 本地目录：开发阶段媒体文件
- FFmpeg / ffprobe：音视频合成和探测
- `httpx`：调用模型供应商 API
- `pytest`：单元与集成测试
- `structlog` 或标准 `logging`：结构化日志

模型 SDK 不必全部引入。第一版可以用 `httpx` 封装供应商接口，减少供应商耦合。

## 3. 总体数据流

```text
上游 Go 服务
  -> POST /internal/v1/tasks
  -> Python API 校验请求、创建任务
  -> Worker / LangGraph 执行
      -> 创作规划
      -> 文案与分镜
      -> 素材检索
      -> 素材缺口判断
      -> AI 补图（必要时）
      -> TTS
      -> 字幕与时间轴
      -> FFmpeg 渲染
      -> 产物校验
  -> 任务状态与结果供上游查询
```

异步任务不要在创建请求的 HTTP 连接里等待整条视频链路完成。API 创建任务后立即返回 `task_id`，由 worker 执行。

## 4. 两条实施路线

### 路线 A：单 Agent / 单图先跑通

一个 LangGraph StateGraph 包含多个职责清晰的节点，节点内部可调用 LLM，也可执行普通 Python。优点是调试简单、成本较低、状态容易追踪。

### 路线 B：多 Agent 编排

将创作、分镜、素材、配音/剪辑质检拆成独立的 Agent 或子图，由 Supervisor/主图调度。只有当角色有独立上下文、独立工具、明确输入输出、需要单独评测时才值得拆分。

推荐顺序：A 跑通并测量 -> 固化契约 -> 将分镜/素材/质检中确实需要推理的模块升级为 B。不是先造多个聊天机器人再拼起来。

## 5. 阶段交付

| 阶段 | 交付物 | 验收 |
|---|---|---|
| 0 | 项目骨架、配置、健康检查 | 本地可启动，缺配置时给出明确错误 |
| 1 | 分镜 Schema + 文案节点 | 结构合法，字段完整，失败能重试 |
| 2 | 素材库与关键词检索 | 每个引用都有来源和授权元数据 |
| 3 | AI 补图适配器 | 缺素材才调用，缓存可命中 |
| 4 | TTS + FFmpeg | 能产出可播放 MP4 与字幕 |
| 5 | 任务持久化和恢复 | 服务重启后可查询任务，不重复扣费或重复生成 |
| 6 | 多 Agent 子图 | Agent 之间通过 schema 交接，不能随意改写共享状态 |
| 7 | 质量评测与成本监控 | 有自动化验收集、失败率、耗时和单条成本统计 |


---

# 01 模型选型与成本控制

## 1. 按职责选模型，不要只按排行榜选

| 能力 | 第一版建议 | 为什么 | 备选/后续 |
|---|---|---|---|
| 文案、分镜、结构化 JSON | DeepSeek Flash 类低成本文本模型 | 先优化结构遵循与成本 | DeepSeek Pro 类模型用于复杂样例对照 |
| 图像生成 | Qwen Image 系列或其他支持商用条款明确的图像 API | 适合按缺口补图，便于控制数量 | 选一款质量更高的模型做 A/B 测试 |
| 中文 TTS | 独立的中文 TTS API | 不要把语音质量寄托在文本模型上 | 按自然度、音色授权、价格、时长限制比较 |
| 视频合成 | FFmpeg | 确定性、成本可控、可复现 | 后续才考虑视频生成 API |

模型名称、区域可用性、价格和条款会变化。接入前应重新查看供应商官方价格页、模型能力说明、数据处理与商用条款。不要把某个价格写死在业务逻辑里。

## 2. 建议先测的组合

- 文本：DeepSeek Flash 作为默认模型；复杂创作可选更强模型，但需要有质量评测证明值得。
- 图片：Qwen Image 作为成本基线，再与一个备选模型对同一组提示词进行盲测。
- TTS：先选一种中文 TTS，确认是否允许生成内容用于目标发布场景、音色是否可商用、是否有内容审核要求。
- 合成：本地 FFmpeg。

可参考官方文档（上线前复查最新内容）：
- DeepSeek API 文档与价格：`https://api-docs.deepseek.com/`
- 阿里云 Model Studio / Qwen Image 文档：`https://docs.modelstudio.console.alibabacloud.com/`
- OpenAI 图像生成文档（可作为质量/成本对照，不是必选）：`https://developers.openai.com/api/docs/guides/image-generation`

## 3. 不要凭感觉估成本

每个任务记录：
- 文本模型输入/输出 token 数和费用估算
- 图片生成数量、尺寸、模型、费用
- TTS 字符数或音频秒数、费用
- FFmpeg 渲染时长与 CPU 时间
- 失败重试次数和失败造成的额外成本

成本估算公式：

```text
任务成本 = 文本费用 + 图片费用 + TTS 费用 + 存储/传输费用 + 可分摊计算成本
```

对每个请求设预算：`max_scenes`、`max_generated_images`、`max_llm_calls`、`max_retry_per_step`。预算由普通代码强制执行，不能让 LLM 自己决定是否超预算。

## 4. 模型选择验收表

同一套 30–50 条中文创作样例，对比：
- JSON 可解析率
- Schema 通过率
- 分镜重复率
- 画面提示词与旁白一致性
- 角色/场景连续性
- 人工盲评得分
- 单任务平均成本和 P95 耗时

不要只看模型演示效果。若便宜模型达到目标，就没有必要默认使用更贵的模型。


---

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


---

# 03 单 Agent 工作流：先把业务链路跑通

这里的“单 Agent”不是只有一个函数，而是一个 LangGraph 主图管理一组确定性节点。每个节点可以调用模型，也可以不调用模型。

## 1. 主流程

```text
START
 -> validate_request
 -> generate_storyboard
 -> validate_storyboard
 -> retrieve_assets
 -> plan_missing_assets
 -> generate_missing_images (if needed)
 -> synthesize_tts
 -> build_subtitles
 -> render_video
 -> validate_output
 -> save_result
 -> END
```

失败路径要显式定义：
- 模型输出不合法：最多修复/重试 N 次，然后失败并保留原始响应摘要。
- 素材不够：先降低镜头复杂度或使用授权替代素材；仍不够则给出明确失败原因。
- 图像生成失败：按预算重试；超过预算则标记场景失败，不要无限循环。
- TTS 失败：可重试；不能默默用空音频继续。
- FFmpeg 失败：保留命令参数、退出码和 stderr 摘要，避免记录 API Key 或用户敏感信息。

## 2. State 设计原则

共享 State 只存跨节点必须传递的数据，不要塞入完整视频二进制或过大的模型历史。

```python
from typing import TypedDict, NotRequired, Any

class AgentState(TypedDict):
    task_id: str
    request: dict
    storyboard: NotRequired[dict]
    asset_plan: NotRequired[dict]
    audio_plan: NotRequired[dict]
    render_plan: NotRequired[dict]
    quality_report: NotRequired[dict]
    errors: NotRequired[list[dict]]
    retry_counts: NotRequired[dict[str, int]]
    status: str
```

实际 LangGraph 中，`errors` 若需累积，应定义 reducer；其他结构化对象通常是 replace 更新。不要把大文件内容放进 State，只传路径、对象存储 key 或数据库 ID。

## 3. 哪些环节必须普通代码控制

- 输入边界与配额
- 最大场景数、最大图片数、最大重试数
- 文件存在性、媒体时长、分辨率、音轨检查
- 授权状态检查
- 任务状态转移
- 幂等、锁、超时和取消
- FFmpeg 调用
- 数据库写入

## 4. 何时升级多 Agent

当出现下列至少一项，再拆独立 Agent：
- 分镜创作需要不同提示词、工具或单独评测；
- 素材检索有独立搜索工具和复杂授权判定；
- 质检需要多轮诊断与定向返工；
- 各能力需要独立版本、限流、缓存或模型；
- 单一节点的提示词/状态已经难以维护。

不要仅仅因为“Agent 热门”就拆分。


---

# 04 多 Agent 架构与协作协议

## 1. 推荐角色（按需启用）

| Agent / 子图 | 负责 | 输入 | 输出 | 不负责 |
|---|---|---|---|---|
| Supervisor / Orchestrator | 决定下一步、读取状态、处理失败分支 | 任务目标、各子图结果 | 下一步路由决策 | 直接剪视频、绕过预算 |
| Creative Agent | 把主题整理为创作 Brief、旁白基调 | 原始主题、风格、受众 | `CreativeBrief` | 选素材、执行 FFmpeg |
| Storyboard Agent | 生成并修订分镜 | Brief、时长、场景限制 | `Storyboard` | 决定超预算继续生成 |
| Asset Agent | 搜索素材、比较语义匹配度和授权元数据 | Storyboard、素材索引 | `AssetPlan` | 把无授权素材标为可商用 |
| Image Fallback Agent | 为缺失场景写图像提示词并请求生成 | 缺口场景、角色参考信息 | 图片资产记录 | 自行决定生成数量上限 |
| Voice Agent | 整理 TTS 文本、音色和节奏配置 | Storyboard | `AudioPlan` / 音频路径 | 改写剧情核心内容 |
| Editing Agent | 产出可执行 RenderPlan | 图片/视频/音频/字幕路径 | `RenderPlan` | 直接执行未经校验的 shell 字符串 |
| Quality Agent | 检查结构、连续性、时长、字幕、素材授权 | 各阶段产物 | `QualityReport` | 随意重写全部结果 |
| Recovery / Retry Policy（普通代码） | 判断是否重试、回滚或终止 | 错误码、次数、预算 | 可执行动作 | 让 LLM 无限重试 |

第一版可先实现 Creative、Storyboard、Asset、Quality 四个逻辑角色；Voice 和 Editing 多数时候应是确定性服务，不需要包装成“会思考的 Agent”。

## 2. Supervisor 不是万能大模型

推荐“代码路由优先，LLM 决策有限”：
- 固定流程由图边决定。
- 只有出现质量不达标、素材缺口、需要返工等分支时，才让 Supervisor 在白名单动作中选择。
- Supervisor 只能返回枚举，例如 `continue`、`revise_storyboard`、`retry_asset_search`、`generate_missing_images`、`fail`。
- 路由前由代码检查预算、状态和重试次数。

禁止让 Supervisor 生成任意 Python、shell 命令或任意节点名称。

## 3. Agent 合约

每个 Agent 采用以下输入输出契约：

```json
{
  "task_id": "task_123",
  "schema_version": "1.0",
  "producer": "storyboard_agent",
  "input_ref": "creative_brief_id",
  "result": {},
  "warnings": []
}
```

建议每个 Agent：
1. 只读取它需要的字段。
2. 只返回自己的结果字段。
3. 不直接修改别的 Agent 的结果。
4. 不直接操作用户积分、鉴权和任务终态。
5. 不保留没有必要的完整聊天历史。
6. 记录模型名、提示词版本、耗时、token/费用和验证结果。

## 4. 避免多 Agent 常见陷阱

- 角色数量不等于能力：多个 Agent 用同一提示词、同一上下文通常只是增加延迟和成本。
- 不允许无边界互相调用：图必须有最大循环次数和截止时间。
- 不把关键规则只写在 Prompt：版权、预算、文件路径、重试上限必须由代码强制。
- 不共享可变大对象：用 schema 化结果交接。
- 不要让每个 Agent 都重新读完整聊天记录；只传 Brief、Storyboard 等最小必要上下文。
- 每个 Agent 必须有单元测试与独立评测样例。


---

# 05 LangGraph 多 Agent 图设计

## 1. 推荐结构：主图 + 有边界的子图

```text
START
  -> intake_node
  -> creative_subgraph
  -> storyboard_subgraph
  -> asset_subgraph
  -> [if gaps and budget allows] image_fallback_subgraph
  -> voice_service_node
  -> render_service_node
  -> quality_subgraph
  -> quality_router
       -> PASS: persist_success -> END
       -> STORYBOARD_ISSUE: storyboard_subgraph (最多 1 次返工)
       -> ASSET_ISSUE: asset_subgraph (最多 1 次重检)
       -> TECHNICAL_ISSUE: recovery_node (有限重试)
       -> FAIL: persist_failure -> END
```

注意：子图不一定都需要 LLM。TTS、FFmpeg、文件验证可以是普通节点。

## 2. State 分层

建议把状态分为三层：

1. **主图共享状态**：`task_id`、`request`、当前阶段、预算、各阶段产物 ID、错误列表。
2. **子图私有状态**：Agent 内部的临时候选、模型修复过程、局部评分。
3. **持久化记录**：数据库中任务、阶段事件、模型调用、资产和最终结果。

不要把所有候选素材、base64 图片、完整供应商响应放到主图 State。文件放磁盘/对象存储，数据库存引用。

## 3. Reducer 策略示例

- `storyboard`: replace
- `asset_plan`: replace
- `retry_counts`: 按 key 更新，避免整个对象被意外覆盖
- `errors`: append reducer
- `events`: append reducer（注意事件 ID 去重）
- `budget_remaining`: 不要用多个并行 Agent 直接无锁扣减；用数据库事务或串行预算节点。

多 Agent 并行执行前，先确保它们不会同时写同一个 State key。并行适合“不同场景的独立素材搜索”，但预算扣减和任务状态转移应由统一协调点处理。

## 4. 路由结果必须受控

定义枚举：

```python
from enum import StrEnum

class RouteDecision(StrEnum):
    CONTINUE = "continue"
    REVISE_STORYBOARD = "revise_storyboard"
    RETRY_ASSET_SEARCH = "retry_asset_search"
    GENERATE_MISSING_IMAGES = "generate_missing_images"
    FAIL = "fail"
```

Supervisor 的输出经过 Pydantic 校验后，再由普通代码确认：
- 当前状态是否允许此动作；
- 是否超过重试次数；
- 是否超时；
- 图片/文本调用预算是否足够；
- 相关素材是否具有可验证的使用权。

## 5. 检查点与恢复

LangGraph checkpointer 可保存图状态，但它不替代业务数据库。业务任务表仍是任务状态的权威来源。建议：
- 每个阶段成功后先写阶段产物和事件，再更新任务阶段；
- 需要恢复时从最近的已完成阶段继续；
- 外部副作用（图像生成、TTS、上传）使用幂等键；
- 不要仅凭“图状态里有结果”就认为文件一定还存在，恢复时要重新验证文件。

## 6. 建议的实现顺序

1. 先用单图实现每个节点和 Schema。
2. 把 `storyboard`、`asset_plan`、`quality_report` 的输入输出固定下来。
3. 把节点包装成独立子图。
4. 最后才加入 Supervisor 的有限路由。
5. 对比拆分前后的质量、成本、耗时。没有收益就保留单图。


---

# 06 素材检索与版权元数据

## 1. 素材策略

本项目采用混合策略：
1. 优先检索自有或授权状态明确的素材；
2. 素材匹配度不足时，尝试其他已授权素材；
3. 仍缺失时，调用 AI 图像生成；
4. 不要默认抓取动漫/影视片段并用于发布。版权风险高，尤其是商业化场景。

## 2. 先用简单检索建立基线

初期字段过滤 + 标签/关键词匹配即可：
- 资产类型、画幅、时长范围
- 场景标签、情绪、风格、人物/角色 ID
- 授权状态和商用许可
- 素材质量评分、使用次数、最近使用时间

候选排序可使用可解释的加权分：

```text
score = 0.35 * tag_match
      + 0.25 * semantic_match
      + 0.15 * aspect_ratio_match
      + 0.15 * quality_score
      + 0.10 * freshness
```

以上权重只是起始假设，要通过人工标注的检索样本调整。版权许可不是一个打分项：无权使用的素材应先过滤，不能因为语义匹配高而进入候选结果。

## 3. 什么时候加 Embedding / 向量库

当关键词检索的 Recall@K 明显不够，且积累了可评测的查询—相关素材样本，再引入 embedding。先比较 SQLite FTS / 关键词、向量召回和混合召回，不要无指标地加基础设施。

## 4. 版权元数据最低要求

```text
asset_id
source_type
source_name
source_url
license_type
commercial_use_allowed
attribution_required
license_evidence_url
license_checked_at
content_hash
```

素材的“授权状态未知”应视为不可用于商业发布，而不是默认可用。保留来源证据、获取时间、授权条款版本和内容哈希。


---

# 07 AI 补图与供应商适配器

## 1. 触发规则

只有当 `AssetPlan` 中存在缺口，并且：
- 任务预算允许；
- 场景不是必须使用某个特定受版权保护角色/镜头；
- 提示词通过内容与品牌/角色约束检查；
才允许生成图片。

不要为了“看起来用了 AI”而把所有场景重新生成。生成结果要落到资产记录中，记录模型、提示词版本、时间、尺寸、费用和内容哈希。

## 2. 提示词构建

提示词应来自结构化字段，不要直接拼接任意用户输入到供应商系统指令：
- 主体与动作
- 场景与构图
- 风格、色彩、光线
- 画幅和清晰度
- 角色连续性描述（原创角色的稳定特征）
- 禁止项：文字水印、错误肢体、额外人物等

角色一致性可使用自有角色设定表、参考图能力（若模型支持）和统一的角色描述；不能承诺仅靠文字提示就完全一致。

## 3. 适配器接口

```python
from typing import Protocol
from pathlib import Path

class ImageProvider(Protocol):
    async def generate(
        self,
        prompt: str,
        *,
        width: int,
        height: int,
        idempotency_key: str,
    ) -> Path:
        ...
```

实现层负责：
- API Key 从环境变量/密钥管理读取；
- 设置连接与读取超时；
- 对 429、5xx 做有上限的指数退避；
- 供应商响应成功后验证图片格式、尺寸、大小；
- 以内容哈希缓存，避免重复生成；
- 日志中禁止输出 API Key、签名 URL 或完整敏感请求。

## 4. 缓存键

```text
sha256(provider + model + normalized_prompt + width + height + prompt_version)
```

如需改变模型或提示词版本，应生成新键；不要把不同版本误认为同一个结果。


---

# 08 TTS 与 FFmpeg 合成

## 1. TTS 责任边界

TTS 输入是通过校验的旁白文本和语音配置，输出是本地音频文件及元数据。每个片段记录：
- scene_id
- text_hash
- provider / model / voice_id
- speed / pitch（若支持）
- duration_ms
- file_path / content_hash
- generated_at

TTS 供应商的音色授权、使用范围和内容政策需要在接入前核实。不要未经许可克隆真实人物声音。

## 2. 字幕

第一版按每个场景的旁白片段生成 SRT，时间轴来自实际音频时长，而不是完全相信模型给出的秒数。若一个场景内语音很长，可按句子切分并对齐；没有强制要求时不必一开始就引入复杂 ASR 对齐服务。

## 3. FFmpeg 渲染

- 使用固定的渲染模板，保证输入相同则输出行为可复现。
- 调用 subprocess 时使用参数数组，不拼接未经校验的 shell 字符串。
- 限制分辨率、帧率、最大时长和并发任务数。
- 渲染后通过 `ffprobe` 检查容器、视频流、音频流、时长和分辨率。
- 失败时保存退出码和 stderr 摘要，清理临时文件但保留必要诊断信息。

## 4. RenderPlan 示例

```json
{
  "width": 1080,
  "height": 1920,
  "fps": 30,
  "format": "mp4",
  "video_codec": "libx264",
  "audio_codec": "aac",
  "subtitle_path": "/work/task_x/subtitles.srt",
  "scenes": [
    {
      "scene_id": "scene_01",
      "visual_path": "/work/task_x/scene_01.png",
      "audio_path": "/work/task_x/scene_01.wav",
      "duration_seconds": 2.7
    }
  ]
}
```

该 JSON 只是结构示例；实际执行前必须校验路径归属、文件存在、扩展名与媒体内容一致，避免路径穿越或执行任意文件。


---

# 09 任务 API 与持久化

## 1. API 建议

- `POST /internal/v1/tasks`：创建任务，返回 `task_id` 和初始状态。
- `GET /internal/v1/tasks/{task_id}`：查询状态、阶段、进度、错误码和结果引用。
- `POST /internal/v1/tasks/{task_id}/cancel`：请求取消（如业务允许）。
- `GET /healthz`：进程健康。
- `GET /readyz`：数据库、工作目录、FFmpeg 等依赖可用性。

接口仅面向受信任的内部调用方；网络隔离或服务间鉴权应由系统边界保证。Python 服务仍要校验请求体和限制资源消耗。

## 2. 任务状态机

```text
queued -> running -> succeeded
                  -> failed
                  -> cancel_requested -> cancelled
```

可选阶段字段：`planning`, `storyboarding`, `asset_search`, `image_generation`, `tts`, `rendering`, `validating`。阶段字段和任务终态分开存储，避免状态语义混乱。

## 3. SQLite 表建议

- `tasks`: task_id、request_id、status、stage、request_json、result_json、error_code、created_at、updated_at。
- `task_events`: event_id、task_id、stage、event_type、payload_json、created_at。
- `agent_runs`: run_id、task_id、agent_name、model_name、prompt_version、input_hash、output_json、status、latency_ms、token_usage、estimated_cost。
- `assets`: asset_id、source_type、source_url、license metadata、content_hash、local_path、media metadata。
- `task_assets`: task_id、scene_id、asset_id、selection_reason。
- `artifacts`: artifact_id、task_id、artifact_type、local_path/object_key、content_hash、metadata_json。

## 4. 幂等与并发

- 用唯一索引约束 `request_id`（若其业务定义是每个请求只创建一次任务）。
- 同一幂等键重复请求应返回已有任务，而不是再次触发模型调用。
- 任务领取与状态更新需使用事务或原子条件更新。
- SQLite 适合本地开发和低并发原型；高并发 worker 可能需要迁移 PostgreSQL 等数据库和独立队列。

## 5. 持久化与检查点的关系

业务数据库记录任务的事实状态和产物引用；LangGraph checkpointer 记录图执行恢复所需状态。二者职责不同。每个阶段成功后先确保产物可访问，再把阶段标记为完成。


---

# 10 可观测性、安全与错误处理

## 1. 每次 Agent 调用记录什么

- `task_id`、`run_id`、`agent_name`、`node_name`
- 模型供应商、模型名、提示词版本
- 输入/输出哈希（必要时仅保留脱敏摘要）
- 开始/结束时间、耗时、token 用量、估算费用
- Schema 校验结果、重试次数、错误码
- 上下游阶段 ID

不要记录 API Key、完整签名 URL、用户私密信息或未脱敏的供应商请求头。

## 2. 错误分类

| 类别 | 示例 | 默认策略 |
|---|---|---|
| 可重试供应商错误 | 429、部分 5xx、临时网络故障 | 有上限退避 |
| 不可重试输入错误 | 主题为空、参数超限 | 立即返回 |
| 模型输出错误 | JSON 无法解析、Schema 不通过 | 最多修复/重试 N 次 |
| 业务不可继续 | 没有合法素材且不允许生成 | 明确失败 |
| 渲染错误 | FFmpeg 非零退出码、输出损坏 | 技术重试一次或失败 |
| 资源限制 | 超时、预算耗尽、磁盘空间不足 | 停止后续昂贵步骤 |

## 3. 任务预算和熔断

对每个任务设置：
- 最大总耗时
- 最大 LLM 调用数
- 最大图片生成数
- 每个节点最大重试次数
- 最大并发渲染数
- 最大输出时长和文件大小

超过限制时必须由代码终止或降级。Supervisor 不能覆盖这些限制。

## 4. 内容与版权边界

- 用户请求内容进入供应商 API 前，应按业务需要进行内容安全检查。
- 素材来源和许可元数据缺失时，不得自动声称可商用。
- 对动漫、影视、音乐和真实人物音色，区分“技术上可获取”与“获得合法使用权”。
- 记录 AI 生成内容来源与必要的标识信息，具体发布要求需按目标平台和司法辖区核实。

## 5. 追踪和指标

至少统计：
- 任务成功率、阶段失败率、平均耗时/P95
- 每个模型的 JSON 合法率
- 素材命中率、AI 补图率、重复生成率
- TTS 成功率、FFmpeg 成功率
- 单任务成本分布
- 多 Agent 路由次数、返工率和额外成本


---

# 11 测试验收与项目目录

## 1. 推荐目录

```text
manjian-agent/
  pyproject.toml
  .env.example
  README.md
  app/
    main.py
    api/
      routes_tasks.py
      schemas.py
    config.py
    domain/
      storyboard.py
      assets.py
      plans.py
      errors.py
    graph/
      state.py
      single_graph.py
      multi_agent_graph.py
      nodes/
      subgraphs/
      routing.py
    providers/
      text/
      image/
      tts/
    services/
      asset_retrieval.py
      render_service.py
      ffprobe_service.py
      task_service.py
    repositories/
      sqlite.py
    workers/
      task_worker.py
    observability/
      logging.py
  tests/
    unit/
    integration/
    evals/
  data/
    assets/
    tasks/
```

## 2. 测试层级

- 单元测试：Schema、预算、路由、授权过滤、文件验证。
- 模型契约测试：用固定 mock 输出测试 JSON 解析和错误修复。
- 集成测试：SQLite、素材检索、TTS mock、FFmpeg 测试样片。
- 端到端测试：输入主题，输出可播放视频、字幕、素材来源清单。
- 回归评测：固定 30–50 个创作请求，版本升级后比较质量与成本。
- 多 Agent 测试：检查非法路由被拒绝、重试上限生效、Agent 不越权修改他人字段。

## 3. 必须覆盖的失败用例

- 文本模型输出缺字段、乱序或超长。
- 素材库没有匹配素材。
- 所有候选素材授权未知。
- 图片 API 429 / 超时 / 返回损坏文件。
- TTS 返回空文件或时长异常。
- FFmpeg 不存在、进程失败、磁盘不足。
- 相同 request_id 重复提交。
- worker 在中途崩溃后恢复。
- Supervisor 要求超预算生成或跳过授权检查。
- 取消任务与渲染同时发生。

## 4. 验收标准

- 结构化输出 Schema 通过率目标建议 ≥ 98%（可用重试后统计）。
- 任务重复提交不会重复启动昂贵工作。
- 未授权素材无法进入最终 RenderPlan。
- 每个阶段失败都有稳定错误码和可定位日志。
- 成功任务产出可播放 MP4、SRT、素材来源清单和成本摘要。
- 多 Agent 版本相较单图版本有明确质量或维护收益；否则不启用为默认。


---

# 12 分阶段实施清单

## 阶段 0：环境与骨架

- [ ] 建立 Python 3.12 项目和依赖锁文件。
- [ ] 配置 `.env.example`，密钥只放环境变量。
- [ ] FastAPI 提供 `/healthz` 和 `/readyz`。
- [ ] 初始化 SQLite、任务表和日志格式。
- [ ] 确认本机 `ffmpeg`、`ffprobe` 可用。

验收：服务可启动，健康检查成功，数据库自动初始化。

## 阶段 1：分镜生成

- [ ] 定义 `CreateTaskRequest`、`Storyboard`、`Scene`。
- [ ] 接入文本模型，强制 JSON / Pydantic 校验。
- [ ] 对非法输出最多重试 1–2 次。
- [ ] 记录提示词版本、模型名、耗时和成本。
- [ ] 建立 30 条固定验收样例。

验收：能稳定生成 15 秒左右的分镜 JSON，不开始生成图和视频。

## 阶段 2：素材检索

- [ ] 建立素材表与本地素材目录。
- [ ] 导入自有/授权测试素材及其许可元数据。
- [ ] 实现标签、关键词、画幅和授权过滤。
- [ ] 输出 `AssetPlan`，明确命中与缺口。
- [ ] 评估 Recall@5 和素材命中率。

验收：没有授权信息的素材不会被当成可商用素材。

## 阶段 3：AI 补图

- [ ] 定义图像供应商接口。
- [ ] 只对缺口场景生成图片。
- [ ] 加入预算、超时、重试、缓存和文件验证。
- [ ] 保存图片来源、模型、提示词版本和内容哈希。

验收：已有素材命中时不重复生成；失败不导致无限循环。

## 阶段 4：TTS + FFmpeg

- [ ] 接入中文 TTS。
- [ ] 根据真实音频时长生成字幕时间轴。
- [ ] 用固定 FFmpeg 模板合成竖屏视频。
- [ ] 用 ffprobe 校验输出。
- [ ] 产出素材清单和成本摘要。

验收：可获得可播放的 MP4 + SRT。

## 阶段 5：异步任务和恢复

- [ ] `POST /tasks` 只创建任务并快速返回。
- [ ] Worker 执行任务并写阶段事件。
- [ ] 查询接口展示阶段、错误和结果。
- [ ] 实现 request_id 幂等。
- [ ] 验证进程重启后的恢复策略。

验收：重复请求不重复生成；崩溃后可从最近完成阶段恢复或安全失败。

## 阶段 6：多 Agent 子图

- [ ] 先把 Creative、Storyboard、Asset、Quality 的输入输出固定。
- [ ] 将它们拆成独立节点或子图。
- [ ] Supervisor 只返回枚举路由决策。
- [ ] 对每个路由实施预算、状态、次数校验。
- [ ] 给每个 Agent 单独写评测与失败测试。
- [ ] 比较单图和多 Agent 的质量、成本、耗时。

验收：多 Agent 不能绕过授权、预算和状态机；路由有循环上限。

## 阶段 7：生产化

- [ ] 根据并发情况决定 SQLite 是否升级。
- [ ] 选择对象存储、队列和任务调度方式。
- [ ] 配置监控告警、密钥管理、备份和清理策略。
- [ ] 核实所有模型、素材和音色的商用条款。
- [ ] 进行负载测试和失败演练。

不要在阶段 0 就先搭建生产级基础设施。先让业务链路与质量指标成立。
