# AI Video Studio

给发布账号批量生产短视频：选业务线和账号类型 -> 设定主题、时长、参考图、视频方向 -> AI 一次生成主题、台词、字幕、分镜 -> 审核分镜 -> 审核台词 -> 立即或夜间在 AutoDL 生成 -> 审核成片 -> 发布。设计文档见同目录三份 `.md`（部分内容已被下面的实现取代，以代码和本文为准）。

```
backend/    FastAPI + SQLAlchemy + Alembic
  app/api         路由（business-lines / accounts / templates / productions / videos / uploads ...）
  app/services    业务逻辑；app/repositories  数据访问；app/models  表结构
  app/domain      状态机（视频任务、生产流程）
  app/pipeline    内容生成节点、提示词拼装（assemble.py）与模板渲染；app/llm  文本模型（DeepSeek）
  app/providers   视频生成服务商（AutoDL ComfyUI）、工作流能力表（workflows.py）；app/scheduling  夜间窗口
  app/workers     video_worker（提交/轮询视频）、pipeline_worker（LLM 阶段 + 状态同步）、runner
  app/seed.py     出厂数据：业务线“视频号”、账号类型“女性向情感治愈类账号”及其四份模板、默认 seed
frontend/   React 18 + TypeScript + Vite + TanStack Query
  src/features    workspace（顶栏与标签页）/ productions / templates / settings
  src/engines     生成引擎模块（目前：autodl-comfyui-i2v，手动生成入口），通过 engines/index.tsx 注册
  src/shared      通用组件；src/api  请求封装；src/tokens.css + base.css + styles.css  样式（Hallmark，Terrazzo 主题）
```

## 数据层级与「配置在库里」

业务线（`business_lines`，如视频号）→ 账号类型（`accounts`，如女性向情感治愈类）→ 提示词模板（`prompt_templates`）→ 生产任务（`productions`）→ 视频任务（`video_tasks`）。

前端选了业务线和账号类型，后端就从库里取这个账号类型的全部配置，生成时现查，**不写在代码里**：

- 生成配置（`accounts.params`，页面「账号设置」里改）：AutoDL 工作流 ID、seed、最短/默认/最长时长、参考图/音频上限、是否必须有参考图、视频方向选项、AutoDL 请求字段名。
- 提示词模板（`prompt_templates`，页面「提示词模板」里改，每次保存是新版本）：8 种，见下。
- `.env` 只放连接和密钥（AutoDL Token、DeepSeek Key、数据库地址等）。
- 缺必需的模板时，创建任务当场报错说明缺哪份，不会悄悄回退到代码里的默认文本。
- 新增一种账号类型：在「账号设置」页底部“复制并创建”，会连配置和全部专属模板一起复制，再去改。

## 流程与三个强制审核点

`AI 生成内容（主题、台词、字幕、分镜）→ 【审核A：分镜】→ 【审核B：台词与字幕】→ 视频生成 → 【审核C：成片】→ 待发布 → 已发布`

- 立即生成和夜间生成都要先过审核 A、B；区别只是通过审核 B 之后，是马上提交还是等夜间窗口。
- 提交给视频模型的提示词由后端按库里的模板拼装：`视频前缀 + 角色设定 + 各镜头 + 台词写法`，见 `app/pipeline/assemble.py`。
- 审核 A、B 可以直接改后通过；带意见重新生成会整体重来（台词和分镜来自同一次生成）；审核 B 可以退回 A。
- 任何阶段都可以废弃。视频一旦提交到 AutoDL 就无法取消（它只有“创建任务/查询结果”两个 API），废弃只是不再跟踪，费用可能已产生。
- 夜间模式：只在 `GENERATION_WINDOW_*` 窗口内提交到 AutoDL；已提交的任务不受窗口限制，会继续轮询。`GENERATION_MAX_INFLIGHT`（默认 3）限制同时在 GPU 上的任务数。排队中的任务显示它在队列里的顺序。
- 成片不满意重新生成时会换一个随机 seed，否则内容相同会得到相同的视频。

## 本地运行

默认 `VIDEO_PROVIDER=fake`、`LLM_PROVIDER=fake`：不调用任何外部服务，产出的是占位内容，只用于跑通链路。

```bash
cd backend
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -e ".[dev]"   # 或 python -m venv + pip install -e ".[dev]"
cp .env.example .env
.venv/bin/python -m uvicorn app.main:app --reload --port 8000   # 启动时自动建表并写入出厂数据（AUTO_MIGRATE=true）
.venv/bin/python -m pytest              # 测试
```

```bash
cd frontend
npm install --include=dev
npm run dev                              # http://localhost:5173，/api 自动代理到 8000
```

使用顺序：顶部选「视频号」和「女性向情感治愈类账号」，在「创建」填写后确认；立即生成会跳到「任务列表」，夜间生成会留在原页方便连续创建；在任务列表里处理待审核的任务。

## 接入真实服务

1. 文本模型：`.env` 设置 `LLM_PROVIDER=deepseek`、`DEEPSEEK_API_KEY`。
2. 视频：`.env` 设置 `VIDEO_PROVIDER=autodl`、`AUTODL_BASE_URL`、`AUTODL_API_TOKEN`；工作流 ID 在页面「账号设置」里填（首次启动时会取 `.env` 里的 `AUTODL_WORKFLOW_ID` 作为初始值）。
3. H3 参考生视频工作流的请求体（官方文档）：`seed`、`prompt`、`duration`（1 到 15）、`resolution`（传选项标签，如 `480p竖`）、`ref_image_0` 到 `ref_image_8`（`ref_image_0` 必填）、`ref_audio_0` 到 `ref_audio_2`，文件类的值都是 **URL**。没有负向提示词和台词参数，所以：台词用「台词写法」模板、负向提示词用「负向写法」模板，都拼进同一个 prompt 发送。这些字段名都在「账号设置」的“请求字段名”里，换工作流时在那里改。
4. **参考图是 URL，AutoDL 要自己去下载**，所以 `PUBLIC_BASE_URL` 必须是公网可访问的地址；`127.0.0.1`、局域网地址会在提交前被拦下并提示。本地调试可用内网穿透，线上建议接对象存储。
5. 第一次成功后看一下任务事件里的结果；若 `results` 里的视频链接域名不是 `autodl.art`，把它加进 `AUTODL_RESULT_ALLOWED_HOSTS`。访问 `GET /api/v1/providers/status` 可自检连接与密钥。

## 提示词模板

9 种，都按账号类型（也可以建业务线通用的）存数据库，匹配优先级：账号类型专属 > 业务线通用 > 全局通用：

- 必需：`content`（发给大模型的系统提示）、`content_user`（用户消息，含本次主题、时长、修改意见）、`video_base`（视频前缀）、`video_shot`（每个镜头怎么写）。
- 可选：`topic_suggest`（“AI 想一个”）、`video_character`（角色设定）、`video_dialogue`（台词怎么写进 prompt）、`video_negative`（负向提示词内容）、`video_negative_line`（负向提示词怎么写进 prompt，变量 `{{negative_prompt}}`；工作流没有负向字段时必须有它，否则创建会被拒绝）。

出厂内容来自 `prompt-temp.md`，其中原本写死的 `16:9` 改成了变量 `{{aspect_ratio}}`，跟随所选视频方向；`content_user`、`topic_suggest`、`video_shot`、`video_dialogue` 是补充的，请按需修改。`video_config`（分辨率、帧率等）保存在账号类型的配置里备查，当前 H3 工作流不使用。

## 线上部署要点

- API 与 Worker 分开：API 设 `WORKER_EMBEDDED=false`，另起 `python -m app.workers.runner`（同时运行视频 Worker 和生产流程 Worker）。
- `DATABASE_URL` 换成 PostgreSQL（`pip install -e ".[postgres]"`），先执行 `alembic upgrade head`。
- 本地存储只适合单机；多实例需在 `app/storage/` 新增对象存储实现并在 `factory.py` 注册（迁小程序时视频也必须走 HTTPS 域名）。
- 当前没有鉴权（按需求仅 2 名管理员使用），请只部署在内网或网关之后；`APP_ENV=production` 会关闭 `/providers/status`。
