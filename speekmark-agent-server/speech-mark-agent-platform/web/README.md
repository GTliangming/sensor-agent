# 语音标注智能体工作台（前端）

这是一个用于学习和调试企业级 Agent 的 React 管理后台。前端页面、交互、模拟数据、统一接口客户端和接口契约已准备好；开发者可以集中精力实现 Go 业务服务与 Python Agent。

## 技术栈

- React + Vite + JavaScript
- Ant Design 5
- React Router
- Axios
- @ant-design/plots

页面展示和操作提示均使用中文。代码变量、路由、HTTP 字段、状态枚举和事件类型保留英文，便于与 Go/Python API 契约一致。

## 本地启动

```bash
cp .env.example .env
npm install
npm run dev
```

默认 `VITE_USE_MOCK=true`，无需启动后端即可体验页面和主要交互。生产构建：

```bash
npm run build
```

接入真实服务时，修改 `.env`：

```env
VITE_API_BASE_URL=/api
VITE_USE_MOCK=false
VITE_APP_NAME=语音标注智能体工作台
```

Vite 默认将 `/api` 代理到 `http://localhost:8000`。若 Go 服务端口不同，请调整 `vite.config.js`。建议浏览器只访问 Go 网关，由 Go 负责用户身份、业务权限与审计，再通过内网调用 Python Agent；不要让浏览器直接持有内部服务凭证。

## 页面清单

| 路由 | 页面 | 能力 |
|---|---|---|
| `/` | 工作台 | 运行指标、趋势图、状态分布、最近任务、快捷入口 |
| `/assistant` | 智能体对话 | 自然语言提交任务、状态轮询、执行轨迹、取消任务、示例问题 |
| `/runs` | 运行记录 | 搜索、状态筛选、分页、耗时和工具调用概览 |
| `/runs/:runId` | 运行详情 | 最终结果、执行事件、工具输入输出、元信息、JSON 导出 |
| `/approvals` | 人工审批 | 待审批动作、查看详情、批准和拒绝交互 |
| `/knowledge` | 知识库 | 文档列表、检索测试台、相似度结果 |
| `/settings` | 系统配置 | 当前开发配置、`.env` 配置生成、后端联调清单 |

## 接口契约

统一接口前缀由 `VITE_API_BASE_URL` 配置。所有接口建议由 Go 网关对前端提供，Go 再根据权限与业务规则调用 Python Agent。

### 创建运行任务

`POST /agent/runs`

```json
{ "input": "查询当前待质检任务最多的三个项目", "mode": "balanced" }
```

响应：

```json
{ "run_id": "run_xxx", "status": "running" }
```

`mode` 只是运行偏好，不是权限字段；服务端必须忽略用户传入的身份、角色、租户或授权声明，并从真实登录态中解析身份。

### 运行任务列表

`GET /agent/runs?page=1&page_size=20&status=succeeded&keyword=质检`

```json
{
  "items": [{
    "run_id": "run_xxx", "input": "用户输入", "status": "succeeded",
    "started_at": "2026-10-22T06:00:00Z", "finished_at": "2026-10-22T06:00:03Z",
    "duration_ms": 3000, "final_answer": "智能体最终回答", "error": null,
    "steps": 4, "tools": 1, "tokens": 800
  }],
  "total": 1, "page": 1, "page_size": 20
}
```

### 运行详情与执行轨迹

- `GET /agent/runs/{run_id}`：返回运行详情。
- `GET /agent/runs/{run_id}/trace`：返回执行事件列表。

执行事件示例：

```json
{
  "run_id": "run_xxx",
  "events": [{
    "event_id": "evt_001", "sequence": 1, "type": "tool.started",
    "node": "get_quality_stats", "title": "调用工具：查询质检统计",
    "detail": "查询本周项目质检统计", "status": "succeeded",
    "timestamp": "2026-10-22T06:00:01Z", "duration_ms": 250,
    "tool_call_id": "tool_001", "input": {"period":"this_week"}, "output": {"projects":12}
  }]
}
```

事件类型建议包括 `run.started`、`agent.plan`、`tool.started`、`tool.completed`、`approval.required`、`run.completed`、`run.failed`。不要把模型隐藏思维链写入轨迹；只记录可审计的阶段摘要、工具调用、参数摘要、耗时、状态和错误。输入输出需过滤敏感字段并限制长度。

### 取消运行任务

`POST /agent/runs/{run_id}/cancel`，响应示例：`{ "run_id": "run_xxx", "status": "cancelled" }`。

若工具已产生外部副作用，取消操作不能假装回滚；服务端应明确表示实际状态。

### 工作台指标

`GET /agent/dashboard`

```json
{
  "totalRuns": 1284, "successRate": 96.8, "avgDuration": 18.6, "toolCalls": 3821,
  "daily": [{"day":"10/22","runs":179}],
  "statuses": [{"type":"成功","value":1120},{"type":"失败","value":48},{"type":"运行中","value":22},{"type":"待审批","value":16}]
}
```

### 人工审批

- `GET /agent/approvals?status=pending`
- `POST /agent/approvals/{approval_id}/approve`，请求体 `{ "comment": "审批意见" }`
- `POST /agent/approvals/{approval_id}/reject`，请求体 `{ "comment": "拒绝原因" }`

Go 服务端必须校验登录身份、资源权限、审批状态机、重复提交和幂等性；前端交互不构成安全边界。

### 知识库

- `GET /agent/knowledge`
- `POST /agent/knowledge/search`，请求体 `{ "query": "切分边界错误" }`

生产检索结果应包含片段引用、文档版本和页码/段落等可追溯来源信息。

### 统一错误格式

```json
{
  "error": {
    "code": "BUSINESS_API_TIMEOUT",
    "message": "查询业务数据超时，请稍后重试",
    "request_id": "req_xxx"
  }
}
```

建议统一使用 JSON 响应，并让 `request_id` 可关联 Go、Python 两侧日志。

## 工程边界与后续增强

- 当前使用轮询观察任务状态；契约稳定后可升级为 SSE，事件通过 `run_id` 与 `event_id` / `sequence` 关联。
- `VITE_USE_MOCK=true` 时数据来自 `src/mocks/data.js`；模拟数据只验证页面和交互，不代表 Agent 已真实调用工具。
- 当前未实现真实登录。接入前需要确定由 Go 网关 Cookie Session 还是短期 Token 负责身份认证。
- 执行轨迹仅展示可审计事件，不记录密钥、完整敏感业务数据或模型隐藏思维链。
- 审批页是交互样板，授权、审批人范围、幂等、状态机、审计和副作用处理必须由 Go 后端完成。
