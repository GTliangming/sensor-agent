# Python Agent 服务

- Python：3.12
- API：FastAPI 0.158.1
- LangChain：1.2.18（遵循用户指定的 1.2.x 系列）
- LangGraph：1.x 系列
- 数据校验：Pydantic 2.x
- 依赖管理：uv

默认保留确定性演示模式，首次启动不需要 API Key。配置 DeepSeek 后，可启用 LangChain/LangGraph Agent 调用在线模型，并使用本地示例 SOP 工具。当前工具返回的仍是演示知识，不会访问真实业务数据库。

## 本地运行（不需要 Docker / Redis）

需要 Python 3.12 与 uv。在项目根目录不需要启动数据库服务；Go 使用 SQLite，Python Agent 当前示例工作流不依赖 Redis。

```bash
uv sync
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
# 新开终端运行测试
uv run pytest
```

OpenAPI 文档：`http://localhost:8000/docs`

## 启用 DeepSeek 在线模型

1. 在 DeepSeek 开放平台创建 API Key。
2. 在项目根目录 `.env`（或 `agent-python/.env`）设置：

```dotenv
MODEL_ENABLED=true
DEEPSEEK_API_KEY=填入你的真实密钥
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

3. 重启 Python Agent。启动日志应显示 `DeepSeek 在线模型`。
4. 在前端发送问题，查看运行详情中的模型节点和工具调用轨迹。

密钥只放在服务端环境变量/本地 `.env` 中，绝不要写进 React 前端、提交到 Git 或贴到聊天中。若暂时不想消耗 API 额度，将 `MODEL_ENABLED=false` 即可回到演示模式。模型名称可通过 `DEEPSEEK_MODEL` 修改；若服务商控制台显示的可用模型名称不同，以你的账号控制台和官方文档为准。

当前的 `search_annotation_sop` 仍是本地示例工具，工具调用本身是真实的模型工具调用，但知识内容不是生产业务数据。后续业务工具应经 Go 后端做鉴权和审计。

## 当前骨架的边界

运行记录和 Trace 暂存在 Python 进程内存，服务重启或多副本部署会丢失/不一致。正式阶段应将 Run/Trace/Checkpoint 持久化，推荐由 Go 的 MySQL 业务库作为查询入口，LangGraph Checkpointer 采用持久化后端，并通过事件表或 Redis Stream/SSE 向前端推送增量事件。
