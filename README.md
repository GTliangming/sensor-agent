# Sensor-Agent · AI Agent 学习与实战仓库

本仓库是多个 AI Agent 相关子项目的集合：从 LangChain / LangGraph 的基础学习 Demo，
到语音标注领域的完整智能运营平台，以及其它练手项目。

## 子项目一览

### 1. `speech-mark-agent-platform/` — 语音标注智能运营分析平台（主项目）

面向语音标注运营场景的 AI Agent 平台：FastAPI 后端 + React 前端，
接入 DeepSeek 大模型，实现智能对话分析与标注运营助手。

- 后端：Python 3.12 + FastAPI + SQLAlchemy（异步）+ SQLite，依赖用 [uv](https://docs.astral.sh/uv/) 管理
- 前端：React 19 + Vite + TypeScript + Ant Design + TanStack Query
- 详见 [backend/README.md](speech-mark-agent-platform/backend/README.md) 与 [frontend/README.md](speech-mark-agent-platform/frontend/README.md)

```bash
# 后端（需要 uv）
cd speech-mark-agent-platform/backend
uv sync
uv run uvicorn app.main:app --reload   # http://127.0.0.1:8000

# 前端
cd speech-mark-agent-platform/frontend
npm install
npm run dev                            # http://localhost:5173
```

### 2. `langchain-agent/` — LangChain 基础学习 Demo

`demo.py ~ demo6.py`：从模型调用、消息、Prompt、工具定义到 `create_agent` 的渐进式示例。
依赖见 `langchain-agent/requirements.txt`。

### 3. `langgraph/` — LangGraph 基础学习 Demo

`demo.py / demo2.py`：StateGraph 图编排、消息状态、记忆（InMemorySaver）等最小示例。
依赖见 `langgraph/requirements.txt`。

### 4. `shop-manager/` — 模拟超市游戏项目（非 AI）

Unity 模拟经营游戏的设计文档与素材：`开发计划.md`、`开发文档.docx`、`game/` 等。

## 根目录环境

- Python 虚拟环境统一放在根目录 `.venv/`（Python 3.12），各子项目共享
- 根 `.env` 统一存放各项目使用的 Key（`DEEPSEEK_API_KEY`、`SILICONFLOW_API_KEY` 等），已被 gitignore，不会提交
- 依赖说明见根目录 `requirements.txt`

## 历史

早期版本是一个独立的「工业传感器领域 RAG 问答 Agent」（Flask + FAISS + React），
已被上面的子项目取代，相关代码与设计文档已从仓库移除（可在 git 历史中找到）。
