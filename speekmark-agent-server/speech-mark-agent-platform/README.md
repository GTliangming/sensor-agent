# 语音标注智能体平台（本地开发骨架）

中文 React 管理后台 + Go/Gin/GORM 业务后端 + SQLite + Python/FastAPI/LangChain/LangGraph Agent。

**当前阶段只考虑本地开发，不需要 Docker、MySQL 或 Redis。** 建议先在本机分别启动三个进程，打通前端 → Go → Python Agent 的调用链路，再逐步增加真实模型和业务能力。Docker 相关文件暂时保留，但可以完全忽略。

## 技术版本

| 模块 | 版本/范围 | 说明 |
|---|---|---|
| Go | 1.23.x | 适配本机现有 Go 1.23.1 环境 |
| Gin | 1.11.0 | HTTP API |
| GORM | 1.31.2 | ORM |
| SQLite | 本地文件 | 第一阶段默认数据库，无需单独安装数据库服务 |
| MySQL | 8.4 LTS | 以后确有需要再切换 |
| Redis | 7.4 | 以后需要缓存/队列时再接入；当前不启动、不连接 |
| Python | 3.12 | Agent 运行环境 |
| FastAPI | 0.158.1 | Agent HTTP API |
| Pydantic | 2.x | 数据校验 |
| LangChain | 1.2.18 | 按要求选择 1.2.x 系列 |
| LangGraph | 1.x | 工作流编排 |
| Python 包管理 | uv | Python 依赖管理 |
| React | 19.x | 前端 |
| Ant Design | 5.x | UI 组件库 |
| Vite | 7.x | 前端开发服务器 |

版本核对参考见 `docs/版本与兼容性.md`。实际依赖安装和完整集成测试仍需在有网络且版本匹配的本地环境执行。

## 目录结构

```text
speech-mark-agent-platform/
├── web/                         # React 中文前端
├── backend-go/                  # Gin + GORM + SQLite
│   ├── cmd/server/
│   ├── internal/{config,database,handler,middleware,model,repository,service,client}/
│   ├── migrations/
│   └── go.mod
├── agent-python/                # FastAPI + LangChain + LangGraph
│   ├── app/{api,core,graph,schemas,services,tools}/
│   ├── tests/
│   └── pyproject.toml
├── docs/                        # API 契约、架构和版本说明
├── .env.example                 # Go 后端本地开发配置
└── deploy/                      # Docker 配置，当前阶段可忽略
```

## 一、环境准备

先安装以下工具：

- **Go 1.23.x**
- **Python 3.12.x**
- **uv**（Python 包管理器）
- **Node.js 20.19+ 或 22.12+**，以及 npm

不需要安装 Docker、MySQL 或 Redis。SQLite 由 Go 的 SQLite 驱动直接读写本地文件。

## 二、准备环境变量

在项目根目录执行：

```bash
cp .env.example .env
```

确认根目录 `.env` 中的 Agent 地址为本地地址：

```dotenv
DATABASE_DRIVER=sqlite
SQLITE_PATH=./data/agent_platform.db
AGENT_BASE_URL=http://localhost:8000
```

前端配置单独放在 `web/.env`：

```bash
cd web
cp .env.example .env
cd ..
```

前端默认通过 Vite 代理访问本机 `http://localhost:8080` 的 Go API。

## 三、启动 Python Agent

**终端 1：**

```bash
cd agent-python
uv sync
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

启动后可以访问：

- Agent API 文档：<http://localhost:8000/docs>
- 健康检查：<http://localhost:8000/health/ready>

默认使用确定性示例工作流，不需要模型 API Key。

## 四、启动 Go 后端

**终端 2：**

```bash
cd backend-go
go mod tidy
go run ./cmd/server
```

Go 会从项目根目录加载 `.env`，自动创建 SQLite 数据目录和数据库表。默认数据库文件位于 `backend-go/data/agent_platform.db`。

验证接口：

- 存活检查：<http://localhost:8080/health/live>
- 就绪检查：<http://localhost:8080/health/ready>

就绪检查中 `database` 应为 `sqlite`，`redis` 应为 `disabled`。

## 五、启动前端

**终端 3：**

```bash
cd web
npm install
npm run dev
```

浏览器访问：<http://localhost:5173>

前端使用 Vite 代理把 `/api/...` 请求转发到本机 Go 服务。开发时不要直接用浏览器访问 Python Agent 来创建 Run；统一由 Go 负责创建运行记录并调用 Agent。

## 六、推荐启动顺序与验证方式

每次开发按下面顺序启动三个终端：Python Agent → Go 后端 → 前端。

1. 打开 `http://localhost:8000/health/ready`，确认 Agent 已启动。
2. 打开 `http://localhost:8080/health/ready`，确认 Go 和 SQLite 已就绪。
3. 打开 `http://localhost:5173`，在助手页面提交一条测试问题。
4. 查看运行记录和 Trace，确认请求经过 Go 后端并调用 Python Agent。

如果前端提示服务不可用，按顺序检查 Python、Go 日志，再检查前端终端的 Vite 输出。

## 常用命令

```bash
# Go 测试
cd backend-go && go test ./...

# Python 测试
cd agent-python && uv run pytest

# 前端生产构建检查
cd web && npm run build
```

## 当前实现范围与重要限制

1. Go 已实现健康检查、SQLite/GORM 自动迁移、运行记录基础查询、创建/查询/取消 Run、Trace、审批接口和知识库占位接口。
2. Go 创建 Run 后调用 Python Agent。当前 Agent 工作流是同步的确定性演示，不是真正的后台长任务。
3. Python Run 与 Trace 当前保存在进程内存；Agent 重启后这些记录会丢失。Go 侧的 Run/Trace 使用 SQLite 持久化。
4. 当前未接真实标注业务 API、向量数据库、登录鉴权或真实模型。模型调用默认关闭，不需要配置 API Key。
5. 取消操作目前主要记录状态，不保证真正中断正在执行的 Agent 工作流。
6. Redis 依赖已从当前 Go 版本移除，等需要缓存、队列或事件流时再单独接入。
7. Dockerfile 和 `deploy/docker-compose.yml` 仅作为未来部署的预留内容，当前开发阶段不需要使用。

## 推荐开发顺序

1. 本机运行三项服务，打通 Chat、Run、Trace。
2. 把 Go 的 Run/Trace 读写整理到 Service/Repository 并补测试。
3. 定义语音标注业务工具的输入、输出与权限边界。
4. 在 Python Agent 中逐步加入 LangGraph 节点和真实模型调用。
5. 等数据量、协作或部署需求明确后，再决定是否切换 MySQL、引入 Redis 和 Docker。

## 验证说明

目前完成了 JS/JSX、Python 语法和配置文件的静态检查；由于生成环境缺少指定版本的 Go、Python 依赖和外网下载能力，尚未完成真实的依赖安装、Go 编译、前端构建和端到端运行。首次在本机安装依赖后，请运行上面的测试命令并根据实际报错逐项处理。静态语法检查不能替代编译和集成测试。
