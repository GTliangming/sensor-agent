# 漫剪师 Agent 服务端（Python）

Python Agent 服务端。**单 Agent 完整链路已跑通**：请求校验 → 分镜生成 → 素材检索与版权过滤 → 缺口补图 → 配音 → 图生视频 → 字幕 → FFmpeg 合成竖屏 MP4 → ffprobe 校验。

> 不负责登录、鉴权、权限、积分、支付、对外网关——这些在上游 Go 服务。详见 `manjian_agent_python_full_docs/`。

## 实现进度（对照文档阶段）

- ✅ 阶段 0 环境与骨架：FastAPI、`/healthz` `/readyz`、SQLite 自动初始化、结构化日志
- ✅ 阶段 1 分镜生成：DeepSeek 出结构化分镜 + Pydantic 校验 + 容错 JSON 解析 + 重试
- ✅ 阶段 2 素材检索：版权优先过滤 + 可解释加权分 + `AssetPlan`（`assets`/`task_assets` 表）
- ✅ 阶段 3 AI 补图：SiliconFlow `Qwen/Qwen-Image`，按预算补缺口、内容哈希缓存、文件校验
- ✅ 阶段 4 配音+合成：CosyVoice2 配音、实测时长字幕、FFmpeg 竖屏 MP4、ffprobe 校验
- ✅ 连续性增强：场景内 Ken Burns 运镜 + 场景间 xfade 交叉淡化（音频 acrossfade）
- ✅ 图生视频（文档"后续"项，已超前实现）：通用适配器 Wan / MiniMax / fake，配音来源可配
- 🟢 阶段 5 异步与恢复：后台执行 + `request_id` 幂等 + 阶段事件/artifacts + **协作式取消**（`/cancel`）+ **崩溃启动恢复**（running 自动重新入队重跑）+ 并发信号量 + 单任务总超时
- 🟢 阶段 6 多 Agent：`multi_agent_graph`（`GRAPH_MODE=multi` 启用）—— 末端加 Quality Agent + Supervisor 有限路由（只返回受控枚举、非法决策拒绝、返工有次数上限、不绕过授权/预算/状态）
- 🟡 阶段 7 生产化（代码可做部分已做）：`/ops/metrics` 指标、`/ops/cleanup` 过期清理 + 保留天数、并发上限、就绪检查；**对象存储 / 独立队列 / 监控告警 / 负载与失败演练属基础设施，未在代码内实现（见下文）**

### 阶段 5-7 接口与配置

- `POST /internal/v1/tasks/{id}/cancel` 协作式取消；`GET /internal/v1/tasks/{id}/runs` 各 Agent 调用的用量/耗时（成本观测）；`GET /internal/v1/ops/metrics` 成功率/状态分布/耗时 P95；`POST /internal/v1/ops/cleanup?days=N` 清理过期任务与文件
- `GRAPH_MODE=single|multi`（默认 single）；`MAX_CONCURRENT_TASKS`、`MAX_SCENE_CONCURRENCY`（场景级并发）、`TASK_TOTAL_TIMEOUT_SECONDS`、`TASK_RETENTION_DAYS`、`RECOVER_ORPHANS_ON_START`、`MAX_STORYBOARD_REVISIONS`、`MAX_ASSET_RECHECKS`
- 未在代码内的生产化项（需运维/基础设施）：对象存储（当前本地目录）、独立消息队列与多 worker（当前进程内后台任务 + 信号量）、监控告警接入、备份策略、负载测试与故障演练

### 健壮性/性能强化（已完成）

- 异步链路里的 ffmpeg/ffprobe 全部走线程池，不再堵塞事件循环
- `MAX_LLM_CALLS` 预算由代码强制（跨多 Agent 返工累计）
- 预算外/生成失败的缺口场景用本地占位图兜底，渲染不再因缺图整体失败
- 补图 / 配音 / 图生视频按场景并发（`MAX_SCENE_CONCURRENCY` 限流）
- `agent_runs` 表记录每个 Agent 的模型/用量/耗时，供成本观测

## 模型分工

- 文本/分镜：**DeepSeek**（`deepseek-chat`）
- 图像补图 / 配音：**SiliconFlow** —— `Qwen/Qwen-Image`、`FunAudioLLM/CosyVoice2-0.5B`
- 图生视频（可选升级）：**通用适配器**，默认 SiliconFlow `Wan-AI/Wan2.2-I2V-A14B`，可切 MiniMax 海螺 `MiniMax-Hailuo-2.3` / `MiniMax-H3`（`VIDEO_GEN_PROVIDER` 控制；`none` 则退回图片 + Ken Burns 运镜）
- 配音来源：`AUDIO_SOURCE=video` 用视频自带音轨（模型需产出音频，如海螺 H3），`tts` 用自家 CosyVoice；模型无音轨时自动回退 TTS
- 合成/运镜/转场：本地 **FFmpeg**（Ken Burns zoompan + 场景间 xfade 交叉淡化，音频 acrossfade，字幕时间轴与过渡对齐）

未配置密钥时各能力自动降级为本地 **fake 桩**（无网络），fake 图生视频用 ffmpeg 产出带运镜的占位短片，**整条链路可离线端到端跑通并产出真实 MP4**。

## 主流程（LangGraph 单图）

```
validate_request -> generate_storyboard -> validate_storyboard
  -> retrieve_assets -> plan_missing_assets -> generate_missing_images
  -> synthesize_tts -> build_subtitles -> render_video
  -> validate_output -> save_result
```

- 关键节点失败即短路到 `save_result`，不再执行后续昂贵步骤。
- 终态：完整出片 `succeeded`；仅到分镜 `storyboard_ready`；失败 `failed`（带稳定错误码）。
- 产物：`data/tasks/<task_id>/output.mp4` 与 `subtitles.srt`，并登记到 `artifacts` 表；成功任务在 `GET` 返回的 `result.render_plan` 里给出路径与 ffprobe 校验信息。

### 要点

- **版权优先**：授权未知/无证据的素材直接排除，绝不进入候选；无命中才按预算补图。
- **补图缓存**：相同 provider+model+提示词+尺寸 命中内容哈希缓存，不重复生成。
- **字幕时间轴**以 ffprobe 实测音频时长为准，不信任模型给的秒数。
- **渲染**：固定模板，subprocess 用参数数组（不拼 shell）；输出后 ffprobe 校验容器/分辨率/音轨/时长。

## 目录结构

```
app/
  main.py / config.py / media_util.py
  api/                         health / tasks 路由与 schema
  domain/                      request / storyboard / assets / plans / errors
  graph/                       state / single_graph / routing
    nodes/                     validate / storyboard / assets / media / persist
  providers/
    text/  image/  tts/  video/   各自 base + 厂商实现 + fake + factory
  repositories/sqlite.py       tasks / task_events / assets / task_assets / artifacts / agent_runs
  services/
    task_service.py            创建→运行图→持久化、取消、恢复、并发、指标、清理
    assets/                    asset_retrieval / asset_seed / image_generation / asset_resolver
    media/                     tts / subtitle / render / ffprobe / timeline / ffmpeg_builder
scripts/seed_assets.py
tests/                         unit + integration（默认 fake provider，无网络；渲染用真实 ffmpeg）
data/
  assets/seed_assets.json      测试素材（2 条故意无授权用于验证过滤）
  generated/                   AI 补图产物（gitignore）
  tasks/<task_id>/             音频 / 片段 / output.mp4 / subtitles.srt（gitignore）
```

## 环境准备

复用上层共享虚拟环境 `../.venv`；需要本机 `ffmpeg` / `ffprobe`。
复制 `.env.example` 为 `.env`，填 `DEEPSEEK_API_KEY` 与 `SILICONFLOW_API_KEY`（模型名也在 `.env` 里，可改）。

## 运行

```bash
../.venv/bin/python -m uvicorn app.main:app --reload --port 8099
curl -X POST localhost:8099/internal/v1/tasks -H 'Content-Type: application/json' \
  -d '{"request_id":"demo1","topic":"雨后的街道","target_seconds":15}'
curl localhost:8099/internal/v1/tasks/<task_id>
```

离线验证（不花额度）：命令前加 `TEXT_PROVIDER=fake IMAGE_PROVIDER=fake TTS_PROVIDER=fake`。

## 测试

```bash
../.venv/bin/python -m pytest -q
```

默认走 fake provider + 临时 SQLite，无网络；渲染相关用例会真实调用 ffmpeg。

## 代码质量

```bash
../.venv/bin/python -m ruff check app tests   # 风格/静态检查
../.venv/bin/python -m mypy app               # 渐进式类型检查（非阻塞）
```

`.github/workflows/ci.yml` 在 push/PR 时自动装 ffmpeg、跑 ruff + mypy(非阻塞) + pytest。

## 前端控制台（web/，React + Vite）

内部「输入主题 → 取出短片」控制台，用 Hallmark 的 **Kiln** 主题（近黑底、奶油字、单点余烬色）设计：生成流程做成一条随管线推进逐段点亮热力色阶的「烧制计划」，成片在 28px 画框里播放，关键数字用 Boska 衬线。

```bash
# 1) 起后端（示例用 fake，离线不花钱；去掉这些环境变量即走真实模型）
TEXT_PROVIDER=fake IMAGE_PROVIDER=fake TTS_PROVIDER=fake VIDEO_GEN_PROVIDER=fake \
  ../.venv/bin/python -m uvicorn app.main:app --port 8099
# 2) 起前端（另开终端）
cd web && npm install --include=dev && npm run dev   # http://localhost:5173
```

- 开发期 `vite.config.ts` 把 `/internal`、`/healthz`、`/readyz` 代理到 `127.0.0.1:8099`，与生产同源、免跨域；后端也配了 CORS（`CORS_ALLOW_ORIGINS`）兜底。
- 调用的后端接口：`POST /internal/v1/tasks`、`GET …/{id}`、`…/{id}/cancel`、`…/{id}/runs`、`…/{id}/video`（新增，`FileResponse` 回传成片 MP4）。
- 设计令牌在 `web/src/styles/tokens.css` + `base.css`（Hallmark 产出），页面样式 `web/src/styles/app.css`，首行是 Hallmark 印章；`sloplint` 检查通过。

## 升级到多 Agent（后续）

主图骨架已为文档 04/05 留好扩展点：`domain/plans.py` 的交接契约、`graph/routing.py` 的 `RouteDecision`、把节点替换为子图并在 `validate_output` 后加入 `quality_router`，无需重写主图。
