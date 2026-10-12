# 后端实现步骤 · 阶段 1（FAISS 轻量版）

> 本文是后端阶段 1 的落地计划：实现**文档管理 + 完整 RAG 问答**，向量检索先用 **FAISS**（本地、无需 Docker），
> 并把检索层做成**可替换接口**，将来换 Milvus 时业务代码不动。
> 先读这篇对齐方案，再动手写代码。

---

## 一、这版要做什么

- 文档：上传 / 列表 / 删除 / 原文件预览
- 处理流水线：解析 → 分块 → 向量化(bge-m3) → **入库(FAISS + SQLite)**，带**四阶段状态**，经 **SSE** 实时推给前端
- 问答：问题 → 向量化 → **FAISS 检索 top-k** → 拼 Prompt → DeepSeek 流式作答 → **带出处**
- 用 **SQLite** 持久化文档元数据、分块文本、状态
- 把前端那套 mock 换成真实后端接口（契约已对齐）

> 不做：Milvus（以后切换）、重排 rerank（阶段 2）、多轮记忆（阶段 2）、鉴权/多租户。

---

## 二、技术选型

- **向量检索**：`faiss-cpu` —— `pip` 安装、无需 Docker；第一版 5~15 篇、几百上千块足够快
- **元数据/状态存储**：`SQLite`（Python 内置 `sqlite3`，零依赖、重启不丢）
- **解析**：`pypdf`(PDF)、`python-docx`(Word)、`openpyxl`(Excel)、内置读 TXT/MD
- **分块**：`langchain-text-splitters` 的 `RecursiveCharacterTextSplitter`（对齐岗位、省事）
- **向量化**：已就绪的 `bge-m3`(SiliconFlow)，1024 维
- **对话**：已就绪的 DeepSeek 流式

---

## 三、关键设计：检索层做成可替换接口

这是整篇最重要的一点——**不要让业务代码直接依赖 FAISS**。定义一个抽象接口，FAISS 和将来的 Milvus 都实现它：

```python
# app/vectorstore/base.py
class VectorStore:
    def add(self, ids: list[int], vectors: list[list[float]]) -> None: ...
    def search(self, vector: list[float], top_k: int) -> list[tuple[int, float]]: ...  # [(chunk_id, score)]
    def remove(self, ids: list[int]) -> None: ...
    def save(self) -> None: ...
```

- 现在写 `FaissStore(VectorStore)`，以后加 `MilvusStore(VectorStore)`，在 `config` 里切一个开关即可。
- 业务层(ingest / rag)只认 `VectorStore`，**换实现时一行业务不改**。

---

## 四、数据与存储设计

- **SQLite**（`data/app.db`）两张表：
  - `documents`：`id, name, ext, size, status, chunks, error, created_at`
  - `chunks`：`id, doc_id, chunk_index, text, page/section 元数据`
- **FAISS 索引**（`data/faiss.index`）：用 `IndexIDMap2(IndexFlatIP)` —— 内积 + 归一化向量 = 余弦相似度；`IDMap` 让每个向量绑定 `chunk_id`，支持按 id 删除。启动时从磁盘加载、变更后落盘。
- **原始文件**（`data/uploads/{doc_id}.{ext}`）：供前端按原排版预览。

> FAISS 存的是"向量 + chunk_id"，真正的文本在 SQLite 的 `chunks` 表里；检索出 id 再回表取文本和出处。

---

## 五、新增目录结构

```
backend/
├── data/                      # 运行时生成（加入 .gitignore）
│   ├── app.db                 # SQLite
│   ├── faiss.index            # FAISS 索引
│   └── uploads/               # 原始文件
└── app/
    ├── db.py                  # SQLite 连接 + 建表 + 文档/分块的增删查
    ├── vectorstore/
    │   ├── base.py            # VectorStore 抽象接口
    │   └── faiss_store.py     # FAISS 实现（以后加 milvus_store.py）
    ├── services/
    │   ├── ingest.py          # 导入流水线：解析→分块→向量化→入库 + 状态流转
    │   ├── parsing.py         # 多格式解析成纯文本
    │   └── rag_service.py     # 问答：检索→拼Prompt→调LLM（替换现 chat_service）
    ├── api/
    │   └── documents.py       # 文档相关接口（上传/列表/删除/预览/进度SSE）
    └── schemas/
        └── document.py        # 文档相关请求/响应模型
```

---

## 六、接口清单（与前端 mock 契约一致）

- `POST   /api/documents`            上传文档（multipart）→ 存原文件 + 建记录(status=pending) + 触发后台处理
- `GET    /api/documents`            文档列表（含状态/分块数）
- `GET    /api/documents/{id}/file`  返回原始文件二进制（前端预览用）
- `DELETE /api/documents/{id}`       删除：记录 + 分块 + FAISS 向量 + 原文件
- `GET    /api/documents/{id}/progress`  **SSE**，实时推该文档的状态流转
- `POST   /api/chat`                 **改造为 RAG**：检索 + 带出处作答（SSE，沿用现有流式）

> 前端 `src/api/documents.ts` 里标注的端点就是这套，接上后把 mock 实现换成 fetch/SSE 即可，UI 不动。

---

## 七、处理流水线（异步 + 状态 + SSE）

1. 上传接口存好原文件、写一条 `status=pending` 的记录，**立刻返回**（不阻塞）
2. 开一个**后台线程**跑流水线，每进一步就更新 SQLite 里的 `status`：
   `parsing → chunking → embedding → storing → done`（出错则 `failed` + 记 `error`）
3. 前端通过 `GET /api/documents/{id}/progress`（SSE）或轮询 `GET /api/documents` 看状态变化
4. 任一步抛异常 → 捕获、置 `failed`、SSE 推错误，不影响其它文档

> Flask dev 用线程即可；量大时再考虑任务队列（Celery/RQ），第一版不需要。

---

## 八、实现步骤（分步，每步可验证）

**基础设施**
1. 装依赖：`faiss-cpu langchain-text-splitters pypdf python-docx openpyxl`
2. `app/db.py`：建库建表 + 基本增删查；`data/` 加进 `.gitignore`
3. `app/vectorstore/base.py` + `faiss_store.py`：封装 FAISS（加载/检索/增/删/落盘）
   - ✅ 产出：写个小脚本塞几条向量、检索、删除，验证 FAISS 读写正常

**导入链路**
4. `app/services/parsing.py`：按扩展名把 PDF/Word/Excel/TXT/MD 抽成纯文本
5. `app/services/ingest.py`：解析→`RecursiveCharacterTextSplitter` 分块→bge-m3 向量化→写 SQLite + FAISS，逐步更新状态
6. `app/api/documents.py`：上传接口触发后台 `ingest`
   - ✅ 产出：上传一篇文档，列表里看到它从 pending 一路走到 done、分块数正确

**文档管理接口**
7. 列表 / 删除 / 原文件预览 / 进度 SSE 四个接口
   - ✅ 产出：前端文档页接上真后端，上传/状态/删除/预览全真实

**问答链路（RAG）**
8. `app/services/rag_service.py`：问题 bge-m3 向量化 → FAISS top-k → 回 SQLite 取片段 → 拼 Prompt（忠于资料 + 标注出处）→ DeepSeek 流式
   - XLSX 按行入库时，top-k 只用于找到相关行。命中的工作表不超过 50 行时，从 SQLite 补齐同一 `doc_id`、同一工作表的记录，再按原行序提供给模型，避免报价汇总漏行。
   - 此补齐兼容现有 `[工作表名] 内容` 格式，无需重新上传。超过 50 行的工作表保留 top-k 结果，因此大表的全量汇总仍需后续增加结构化查询或分页能力。
   - 回归验证：在 `backend/` 执行 `.venv/bin/python -m unittest discover -s tests -p test_sheet_retrieval.py -v`；测试使用临时数据库，不修改实际上传资料。
9. 改 `POST /api/chat` 走 `rag_service`
   - ✅ 产出：问一个文档里有答案的问题，能答对并给出出处；问没有的，回"资料中未提及"

**前端对接**
10. 把 `src/api/documents.ts` 的 mock 换成真实 fetch/SSE；提问页展示引用来源
    - ✅ 产出：阶段 1 完整闭环跑通

---

## 九、注意事项

1. **向量维度一致**：建 FAISS 索引用 1024，和 bge-m3 必须一致；入库和检索用同一个 embedding。
2. **余弦相似度**：用 `IndexFlatIP` + 向量**归一化**，等价于余弦；别忘了归一化。
3. **删除要删干净**：记录、分块、FAISS 向量(`remove_ids`)、原文件四处都要删。
4. **FAISS 落盘时机**：增/删后 `write_index`，避免进程重启丢索引；并发写加锁。
5. **扫描型 PDF**：抽不出文字 → 该文档置特殊状态或标注"需 OCR"，第一版可先跳过检索。
6. **预览 ≠ 解析**：预览走原始文件(前端渲染)，RAG 走抽取的纯文本，两条路分开。
7. **Key 与 data/ 不进 git**：`.env`、`data/` 都加 `.gitignore`。
8. **Milvus 切换**：以后只加 `MilvusStore` 实现 `VectorStore`，`config` 加开关，业务不动。

---

## 十、依赖清单（新增）

```
faiss-cpu
langchain-text-splitters
pypdf
python-docx
openpyxl
```

> SQLite 用 Python 内置 `sqlite3`，无需额外安装。

## 下一步

你看完这篇、确认方案没问题后，我按"八、实现步骤"从第 1 步开始落地，每步做完给你可验证的产出。
