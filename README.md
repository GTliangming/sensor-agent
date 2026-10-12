# Sensor-Agent · 工业传感器 / 示波器领域 AI Agent

一个面向工业传感器、示波器垂直领域的 AI Agent 项目:喂入该领域的 datasheet、手册、规格书等文档，
实现「基于文档检索作答 + 带出处 + 可调工具 + 带记忆」的智能问答与任务助手。

> 本仓库当前只包含**设计文档**，暂不含代码。代码会在设计对齐后按文档里的实现步骤逐步落地。

## 这个项目要解决的真实问题

对照目标岗位（企业级 AI Agent 开发）的硬要求，本项目用来补齐三块短板：

- **真实上线、可访问的 AI Agent 项目**（非 Demo、非纯调 API）
- **RAG 全链路**：文档解析 → 分块 → Embedding → 向量检索 → 重排
- **Agent 编排**：任务规划 → 工具调用 → 记忆管理

## 技术栈一览

- 前端：React（Vite + TypeScript），两个页面——①文档管理页（上传多格式文档 / 列表 / **按原始排版预览**）②提问页（SSE 流式问答 + 引用展示）
- 文档格式：PDF / Word(docx) / Excel(xlsx) / TXT / Markdown；预览用 pdf.js、docx-preview、SheetJS 等前端渲染库还原排版
- 后端：Python + **Flask**
- AI 编排：**LangChain + LangGraph**
- 向量库：**Milvus**（Docker）
- 记忆 / 缓存：**Redis**（Docker）
- 对话模型：**DeepSeek**（OpenAI 兼容接口）
- 向量模型：**bge-m3 via 硅基流动 SiliconFlow**（因为 DeepSeek 没有 embedding 接口，见下）

## 开工前需要准备的 Key

1. **DeepSeek API Key** —— 负责对话 / 推理（你已有）
2. **SiliconFlow API Key** —— 负责 embedding（`bge-m3`），有免费额度
   - ⚠️ 关键坑：**DeepSeek 官方没有 embedding（向量化）接口**，RAG 的向量化必须另找服务，详见设计文档。

## 开工前的环境要求

- **Python** ≥ 3.10（LangChain 生态建议 3.10+）
- **Node.js** ≥ 18（Vite 5 要求）
- **Docker** + **Docker Compose**（用来跑 Milvus / Redis；装 Docker Desktop 即可）
- 建议用 Python 虚拟环境（venv / conda）隔离依赖

## 文档地图

- [`docs/01-方案设计与实现计划.md`](docs/01-方案设计与实现计划.md)
  —— 完整分析过程、第一版功能目的、项目架构、实现步骤、数据准备、效果评测、注意事项、配置示例（**先读这篇**）
- [`docs/02-分层深入与升级路线.md`](docs/02-分层深入与升级路线.md)
  —— 第一版跑通后，如何一层层深入原理、从哪里入手、怎么升级到生产级
- [`docs/03-术语表.md`](docs/03-术语表.md)
  —— 前端视角的 AI 术语速查（embedding / rerank / Agent / LangGraph 等），遇到生词回来查

## 阅读顺序建议

先通读 `01`，建立"要做什么、怎么搭"的整体认知；动手把第一版跑通后，再按 `02`
挑你最想吃透的那一层深入。不要一开始就陷进某一层的原理里，**先让链路跑通**。
