# Annotation Ops Agent · Frontend

语音标注智能运营分析平台的独立前端。React 19 + Vite + Ant Design + React Router + TanStack Query。

前端只消费 FastAPI，不直接调用 Go 标注平台。

## 快速开始

```bash
cd frontend
npm install
npm run dev
```

默认地址：<http://localhost:5173>

开发模式默认启用本地 Mock（`VITE_USE_MOCK=true`），任意非空用户名和密码即可登录，对话页会返回占位分析结果。

## 脚本

| 命令 | 说明 |
|---|---|
| `npm run dev` | 启动开发服务器，`/api` 代理到 `http://127.0.0.1:8000` |
| `npm run build` | 类型检查 + 生产构建 |
| `npm run preview` | 预览构建产物 |
| `npm run typecheck` | 仅做 TypeScript 类型检查 |

## 环境变量

| 变量 | 说明 |
|---|---|
| `VITE_API_BASE_URL` | FastAPI 前缀，默认 `/api` |
| `VITE_USE_MOCK` | 是否启用前端 Mock；后端就绪后改为 `false` |

参考 `.env.example` / `.env.development` / `.env.production`。

## 目录结构

```text
frontend/
├── src/
│   ├── components/          # 通用组件（PageContainer、PageLoading）
│   ├── layouts/             # AppLayout（侧边栏 + 顶栏 + 内容区）
│   ├── pages/               # 页面
│   │   ├── login/           # 登录
│   │   ├── chat/            # 对话工作台 + 执行过程
│   │   ├── analytics/       # 数据分析
│   │   ├── reports/         # 报告列表 / 详情
│   │   ├── knowledge/       # 知识库（V0.6）
│   │   ├── history/         # 历史记录
│   │   ├── admin/           # Agent 管理（V0.4+）
│   │   ├── monitor/         # 系统监控（V0.9）
│   │   └── not-found/       # 404
│   ├── router/              # 路由与登录守卫
│   ├── services/            # http / auth / agent / report / mock / token
│   ├── stores/              # Zustand（登录态）
│   ├── styles/              # 主题 token 与全局样式
│   ├── types/               # 共享类型
│   ├── utils/               # 格式化工具
│   ├── App.tsx
│   └── main.tsx
├── .env.development
├── .env.production
├── .env.example
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 与后端的约定

前端默认调用以下路径（`baseURL = /api`）：

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | 返回 `{ token, user }` |
| GET | `/api/auth/me` | 当前用户 |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/agent/threads` | 会话列表 |
| POST | `/api/agent/threads` | 创建会话 |
| POST | `/api/agent/threads/{id}/runs` | 启动一次分析 |
| GET | `/api/agent/runs/{id}` | 运行状态 |
| GET | `/api/agent/runs/{id}/trace` | 执行轨迹 |
| GET | `/api/agent/reports` | 报告列表 |

响应兼容两种形态：

1. 直接返回业务数据；
2. 返回统一信封 `{ ok, data, meta, warnings }`。`ok=false` 时前端抛出 `ApiError`，`401` 会清理登录态并跳转 `/login`。

## 当前状态

- [x] 项目结构、路由、布局、登录态
- [x] 对话工作台骨架（Mock 可用）
- [x] 数据分析 / 报告 / 知识库 / 历史 / 管理 / 监控占位页
- [x] Axios 封装、统一错误、401 处理
- [ ] 接入真实 FastAPI
- [ ] SSE 流式输出
- [ ] 报告图表与导出
- [ ] 工具执行轨迹详情
