# Annotation Ops Agent — 后端

基于 **FastAPI** 的标注运营 Agent 后端服务，使用 [uv](https://docs.astral.sh/uv/) 管理依赖与运行环境。

## 技术栈

- Python 3.12（见 `.python-version`）
- FastAPI + Uvicorn（ASGI 服务）
- Pydantic Settings（配置管理）
- SQLAlchemy 2.x（异步）+ aiosqlite（默认 SQLite）
- httpx（调用业务侧接口）
- 开发工具：pytest / pytest-asyncio、ruff、mypy

## 目录结构

```
backend/
├── app/
│   ├── main.py            # 应用入口（组合根），uvicorn 读取的 app.main:app
│   ├── api/               # 路由：router.py 汇总，health.py 健康检查
│   ├── core/              # 配置、日志、中间件、异常、生命周期
│   └── schemas/           # 统一响应信封等数据模型
├── tests/                 # pytest 用例
├── data/                  # SQLite 数据库文件存放处（已 gitignore）
├── .env.example           # 环境变量模板
├── pyproject.toml         # 依赖与工具配置
└── uv.lock                # 锁定的依赖版本
```

## 环境准备

1. 安装 uv（任选其一）：

   ```bash
   # macOS / Linux
   curl -LsSf https://astral.sh/uv/install.sh | sh
   # 或使用 Homebrew
   brew install uv
   ```

2. 同步依赖（uv 会自动创建 `.venv` 并按 `uv.lock` 安装，含开发依赖）：

   ```bash
   cd backend
   uv sync
   ```

## 配置

配置从环境变量与 `backend/.env` 文件加载（`pydantic-settings`，大小写不敏感）。

复制模板并按需填写：

```bash
cp .env.example .env
```

关键配置项（完整列表见 `app/core/config.py`）：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `APP_ENV` | 运行环境：`development` / `test` / `production` | `development` |
| `APP_NAME` | 应用名称 | `Annotation Ops Agent` |
| `APP_SECRET_KEY` | 签发登录态等用途，**生产环境必填** | 空 |
| `LOG_LEVEL` | 日志级别 | `INFO` |
| `DATABASE_URL` | Agent 自有数据库连接串 | `sqlite+aiosqlite:///./data/app.db` |
| `LLM_PROVIDER` | 模型供应商 | `deepseek` |
| `DEEPSEEK_API_KEY` | DeepSeek 密钥，调用 LLM 时必填 | 空 |
| `DEEPSEEK_BASE_URL` | DeepSeek 接口地址 | `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | 模型名 | `deepseek-chat` |
| `ANNOTATION_API_BASE_URL` | 标注平台接口根地址 | 空 |
| `AGENT_SERVICE_ID` / `AGENT_SERVICE_SECRET` | Agent 服务身份凭证 | 空 |
| `ANNOTATION_API_TIMEOUT_SECONDS` | 调用业务接口超时（秒） | `10` |
| `CORS_ORIGINS` | 允许跨域的前端地址，需写成 JSON 数组字符串 | `["http://localhost:5173","http://127.0.0.1:5173"]` |

> 注意：
> - `.env` 内严禁提交真实密钥（已在 `.gitignore` 中忽略）。
> - `CORS_ORIGINS` 必须是 JSON 数组字符串，例如 `CORS_ORIGINS=["http://localhost:5173"]`。
> - `.env` 按**当前工作目录**解析，因此需在 `backend/` 目录下启动服务。
> - 默认使用 SQLite，数据库文件位于 `backend/data/app.db`，`data/` 目录已存在（`.gitkeep`）。

## 启动

在 `backend/` 目录下运行：

```bash
# 开发模式（热重载）
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

启动后：

- 健康检查：http://localhost:8000/api/health
- Swagger 文档：http://localhost:8000/api/docs
- OpenAPI：http://localhost:8000/api/openapi.json

生产环境示例（关闭热重载、可按需开多进程）：

```bash
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

## 测试与质量检查

```bash
# 运行测试
uv run pytest

# 代码风格检查与修复
uv run ruff check .
uv run ruff format .

# 静态类型检查
uv run mypy .
```

## 快速验证

```bash
curl http://localhost:8000/api/health
```

正常返回形如：

```json
{
  "ok": true,
  "data": { "status": "ok", "appEnv": "development", "version": "0.1.0", "serverTime": "..." },
  "meta": { "requestId": "req_..." }
}
```
