# 附录：后续能力与参考资料

**项目：** Annotation Ops Agent
**版本：** V1.0
**日期：** 2026-11-02
**来源：** 从 `annotation_ops_agent_plan_v1_1.md` 抽取，仅保留与现行方案不冲突的后续能力设计与参考资料

> **说明：** 本附录不是第一阶段实施依据。第一阶段的方案以《01 业务需求与功能清单》《02 系统技术架构设计》《03 分阶段开发任务与验收标准》为准。V1.1 中“复用 Vue3、不建 React、嵌入现有平台”的集成方式已随原文件删除，不再适用。

---

## 1. MCP 后续方案（V0.10+ 可选）

### 1.1 定位

第一阶段使用纯函数工具 + 统一注册表，不引入 MCP。工具已按 MCP-ready 设计：注册表保存 `name / description / input_model / output_model / risk_level / timeout / handler`。后续只需增加适配层，把注册表映射为 MCP Tool，业务函数不改。

MCP 的价值在于把业务能力以标准协议暴露给不同客户端，不是 Agent 编排框架的替代品：

- **Function Calling**：模型生成工具名与参数，应用负责执行并回传结果；
- **MCP**：让 Tools / Resources / Prompts 通过标准协议被发现和调用；
- **Agent Runtime**：决定是否需要工具、调用顺序、如何处理结果、何时结束。

### 1.2 服务设计

```text
services/annotation-mcp-server/
├── server/
│   ├── tools/
│   ├── resources/
│   ├── prompts/
│   ├── auth/
│   └── main.py
└── pyproject.toml
```

服务职责：

- 声明可用的 Tools、Resources、Prompts；
- 校验工具输入参数；
- 获取并验证调用者身份上下文；
- 按调用者权限控制数据范围；
- 调用业务 Adapter 或 Quality Service；
- 标准化输出与错误；
- 记录脱敏后的审计信息。

### 1.3 Tools 候选

| 工具名 | 输入 | 输出 | 风险 |
|---|---|---|---|
| `list_accessible_projects` | filter、page、page_size | 可见项目列表 | R0/R1 |
| `get_project_overview` | project_id、time_range | 项目进度摘要 | R1 |
| `list_tasks` | project_id、status、time_range、page | 任务列表 | R1 |
| `list_task_bundles` | task_id、status、assignee_id、page | 题包列表 | R1 |
| `get_bundle_detail` | bundle_id | 题包状态、承接信息、题量 | R1 |
| `get_bundle_questions` | bundle_id、page、page_size | 题目摘要 | R2 |
| `get_question_annotations` | question_id | 标注与审核摘要 | R2 |
| `get_annotator_profile` | annotator_id、time_range | 授权范围内人员统计 | R2 |
| `get_quality_statistics` | scope、time_range、metrics | 质量指标 | R1 |
| `get_production_statistics` | scope、time_range、group_by | 生产指标 | R1 |
| `sample_questions` | bundle_id、sample_size、strategy | 抽样 ID 与依据 | R1 |
| `search_guidelines` | query、project_id、version、filters | 规范片段与引用 | R0/R1 |
| `get_guideline` | guideline_id、version | 指定规范内容 | R1 |

第一版不要一次性全部实现；按《03》的阶段逐步增加。

### 1.4 Resources 候选

```text
annotation://projects/{project_id}/overview
annotation://projects/{project_id}/guidelines/{version}
annotation://metrics/{metric_name}
annotation://projects/{project_id}/schema
annotation://quality-cases/{case_id}
```

Resources 适合读取确定上下文；动态搜索使用 Tool。

### 1.5 Prompts 候选

- `daily_production_review`：生产日报巡检
- `bundle_quality_audit`：题包质量审查
- `annotator_quality_review`：标注员质量分析
- `guideline_conflict_analysis`：规范冲突分析
- `root_cause_analysis`：异常根因分析
- `rework_plan`：返工方案生成

Prompt 只是模板；权限必须由服务端代码强制执行。

### 1.6 传输方式

- 本地开发与协议调试：`stdio`；
- 服务拆分后：官方 SDK 支持的 HTTP 传输，优先评估 Streamable HTTP；
- 不优先采用旧式 SSE，除非客户端兼容性确有要求。

具体 API 以锁定的官方 MCP Python SDK 版本为准，注意 v1/v2 差异。

### 1.7 输出契约

成功：

```json
{
  "ok": true,
  "data": {
    "bundle_id": "BUNDLE-001",
    "status": "in_progress",
    "question_count": 120,
    "completed_count": 78,
    "assignee": {"id": "USER-021", "display_name": "脱敏名称"}
  },
  "meta": {
    "source": "annotation-platform-api",
    "fetched_at": "2026-11-02T08:00:00Z",
    "request_id": "req_xxx",
    "partial": false
  },
  "warnings": []
}
```

失败：

```json
{
  "ok": false,
  "error": {
    "code": "PLATFORM_PERMISSION_DENIED",
    "message": "当前用户无权查看该题包",
    "retryable": false
  },
  "meta": {"request_id": "req_xxx"}
}
```

不要把内部堆栈、Token、完整隐私字段回传给模型。

### 1.8 MCP Server 验收

- [ ] Client 能连接 Server
- [ ] 能列出 Tools / Resources / Prompts
- [ ] 能按 Schema 发现并调用 Tool
- [ ] 输入错误时返回可理解错误，无副作用
- [ ] 无权限数据不可读
- [ ] 输出符合统一契约
- [ ] 有超时、日志、request_id
- [ ] 全部工具只读
- [ ] 有契约测试

---

## 2. 微调策略（V1.1+ 可选）

### 2.1 前提

微调不是第一阶段目标。先用以下手段解决问题：

1. Prompt 与结构化输出；
2. 工具定义与参数 Schema；
3. RAG 与版本过滤；
4. 确定性业务规则；
5. Agent 评测与错误分析。

只有当评测证明问题属于模型稳定性、格式遵循或特定分类能力不足时，才考虑微调。

### 2.2 适合的任务

- 标注缺陷类型分类；
- 审核意见归类；
- 复杂描述转标准问题标签；
- 固定报告结构的格式遵循；
- 专业术语识别。

### 2.3 不适合用微调解决

- 频繁更新的规范知识 → RAG；
- 当前题包状态 → Go API；
- 人员当前负载 → 实时数据；
- 权限控制 → 代码强制执行；
- 业务动作审批 → 工作流与服务端控制。

### 2.4 实验流程

```text
人工审核通过的案例
  → 清理隐私与敏感字段
  → 统一标签体系
  → 标注数据质量审查
  → 切分 train / validation / test
  → 建立 Prompt + RAG 基线
  → SFT / LoRA 实验
  → 对照评测
  → 错误分析
  → 决定是否上线
```

### 2.5 数据泄漏

同一项目、同一原始样本或高度相似案例不得同时进入训练集与测试集。样本规模由任务、模型与评测结果决定，不预设“达到某个数量就有效”。

---

## 3. 参考资料与学习顺序

> 链接与项目状态以实际访问时为准，不直接拼装为生产系统。

### 3.1 标注平台参考

- **Label Studio**：<https://github.com/HumanSignal/label-studio> — 多类型标注、项目/任务配置、标注结果结构、平台 API。
- **Label Studio MCP Server**：<https://github.com/HumanSignal/label-studio-mcp-server> — 如何把标注平台 SDK 封装为 MCP Tools。
- **CVAT**：<https://github.com/cvat-ai/cvat>、<https://docs.cvat.ai/> — Project/Task/Job、团队协作、质量控制、Consensus、Ground Truth。
- **LabelForge**：<https://github.com/sairamsrujan/labelforge> — Active Learning、多人标注共识、Kappa 报告。

### 3.2 Agent 编排与记忆

- **LangGraph**：<https://docs.langchain.com/oss/python/langgraph/overview>
- **Persistence**：<https://docs.langchain.com/oss/python/langgraph/persistence>
- **Human-in-the-loop**：<https://docs.langchain.com/oss/python/langgraph/human-in-the-loop>

### 3.3 MCP

- **官方 Python SDK**：<https://github.com/modelcontextprotocol/python-sdk>
- **SDK 文档**：<https://py.sdk.modelcontextprotocol.io/>
- **协议规范**：<https://modelcontextprotocol.io/specification>

### 3.4 RAG 与检索

- **Qdrant Hybrid Search / Reranking**：<https://qdrant.tech/documentation/tutorials-basics/reranking-hybrid-search/>

### 3.5 模型工具调用

- **DeepSeek Tool Calls**：<https://api-docs.deepseek.com/guides/tool_calls/>

### 3.6 学习顺序

1. 第一阶段：DeepSeek Tool Calls、FastAPI、Pydantic、httpx；
2. MCP 阶段：官方 Python SDK 教程，再对照 Label Studio MCP Server；
3. 编排阶段：LangGraph Tools / ToolNode、MCP Client；
4. RAG 阶段：基本流程、混合检索、Reranker；
5. Memory 阶段：LangGraph Persistence / Store；
6. 多 Agent 阶段：Subgraph、Human-in-the-loop；
7. 最后：评测、可观测性、微调。

---

## 4. 附录：第一版关键业务问题集（20 条）

用于验证 Agent 是否真正理解业务：

1. 我目前能访问哪些标注项目？
2. 项目 A 当前有多少任务？
3. 项目 A 最近一天新增了多少题包？
4. 哪些题包还没有承接人？
5. 哪些题包已经分配但长期没有进展？
6. 题包 B 当前承接人是谁？
7. 题包 B 下面有多少题目，当前完成情况如何？
8. 项目 A 最近一周的完成率变化如何？
9. 当前各承接人的题包负载有什么差异？
10. 哪些题包值得优先抽检？请说明筛选依据。
11. 题包 B 的质量异常是否有审核记录支持？
12. 当前结论使用的是哪个规范版本？
13. 规范中对某类时间戳误差的要求是什么？
14. 某个历史争议案例最后如何判定？
15. 这次异常结论中哪些是事实，哪些只是原因假设？
16. 当前数据是否完整？是否存在分页未读完的情况？
17. 给出返工建议，但不要执行任何操作。
18. 如果题包状态在审批期间发生变化，旧方案还能执行吗？
19. 当前用户为什么不能查看某个项目？
20. 请把本次巡检结果整理为可复核报告。

---

## 5. API 接入检查清单

### 5.1 必须取得的资料

- [ ] Swagger / OpenAPI JSON、YAML 或在线接口文档
- [ ] 测试环境 Base URL（优先）
- [ ] 鉴权方式说明（不需要真实凭据）
- [ ] 项目、任务、题包、题目、标注记录、人员、工作组只读接口
- [ ] 脱敏后的真实响应样例
- [ ] 分页与筛选规则（页码/游标、最大 page_size、排序、时间与状态筛选）
- [ ] 业务状态定义与流转关系
- [ ] 数据权限范围（管理员、项目管理员、工作组管理员、成员）

### 5.2 接口优先级

| 优先级 | 能力 | 第一阶段 |
|---|---|---|
| P0 | 当前用户可访问项目列表 | 是 |
| P0 | 项目概览或详情 | 是 |
| P0 | 任务列表 | 是 |
| P0 | 题包列表与详情 | 是 |
| P1 | 题包下题目列表 | 尽量 |
| P1 | 标注记录与审核结果 | 尽量 |
| P1 | 用户/承接人信息 | 尽量 |
| P2 | 工作组与成员关系 | 后续 |
| P2 | 历史状态流转与审计 | 后续 |
| P2 | 质量复核、返工、重新分配写接口 | 不开放 |

### 5.3 接入检查

- [ ] 路径与 Method 来自真实文档或代码确认
- [ ] 鉴权与权限边界已确认
- [ ] 返回字段与业务含义已确认
- [ ] 分页逻辑已验证，不会静默漏数据
- [ ] 时间范围与时区已确认
- [ ] 速率限制与超时已确认
- [ ] 只读账号或只读权限已启用
- [ ] 敏感字段已识别并有脱敏策略
- [ ] 原始响应样例已脱敏保存
- [ ] 有副作用的接口已加入黑名单

---

## 6. 常见误区与正确做法

| 误区 | 后果 | 正确做法 |
|---|---|---|
| 一开始就上多 Agent | 难以定位问题 | 单 Agent 稳定后再拆 |
| 把 MCP 当 Agent 框架 | 概念混淆 | MCP 是工具互操作协议，编排由 Runtime 负责 |
| 用 LLM 算统计 | 数字不一致或编造 | 程序计算，LLM 解释 |
| 只用向量检索规范 | 条款编号与术语召回差 | 混合检索 + 重排 |
| 把业务状态塞进 Memory | 信息过期 | 实时状态查 Go API |
| 微调知识问答模型 | 更新困难、来源不可追溯 | 规范知识优先 RAG |
| 让 Agent 生成 SQL | 权限与数据风险 | 受控业务工具 + 服务端校验 |
| 把所有 API 暴露成工具 | 工具爆炸、权限失控 | 设计语义明确的业务工具 |
| 反思无限循环 | 成本与延迟失控 | 明确验证目标与最大轮次 |
| 用综合分数评价人员 | 不公平、不可解释 | 多维指标 + 样本量 + 上下文 |
| 依赖模型自我评估 | 自我偏袒 | 人工标准答案 + 程序断言 + 专家抽检 |
| 真实数据直接送外部模型 | 隐私与合规风险 | 先确认授权、脱敏与服务边界 |
| 写入返回 200 就认为成功 | 平台状态可能未变 | 写后重新查询并审计 |

---

## 7. 子 Agent 结构化交接（V0.8 参考）

子 Agent 之间不依赖长篇自然语言，使用结构化结果。异常诊断示例：

```json
{
  "issue_id": "ISSUE-001",
  "issue_type": "annotation_disagreement",
  "scope": {
    "project_id": "PROJECT-001",
    "bundle_id": "BUNDLE-001"
  },
  "severity": "medium",
  "facts": [
    {
      "statement": "抽样 30 道题中有 8 道存在审核分歧",
      "source_ids": ["review-1", "review-2"],
      "calculation": "8 / 30"
    }
  ],
  "guideline_evidence": [
    {
      "document_id": "GUIDE-001",
      "version": "v3",
      "section": "2.4.1",
      "quote": "脱敏后的规范引用"
    }
  ],
  "hypotheses": [
    {
      "reason": "规则理解可能不一致",
      "evidence_for": ["..."],
      "evidence_against": [],
      "confidence": "medium"
    }
  ],
  "missing_information": []
}
```

输出必须区分：

- `facts`：平台数据或确定性程序支持的事实；
- `guideline_evidence`：规范原文、版本、条款；
- `hypotheses`：模型提出的原因假设，含支持与反对证据、置信度；
- `missing_information`：当前证据无法确定的部分。

---

## 8. 学习目标矩阵

| 技术模块 | 必须掌握 | 在项目中的落地 |
|---|---|---|
| LLM 与 Prompt | 上下文、角色指令、结构化输出、窗口限制 | 质量分析与任务规划 |
| Function Calling | 工具请求生成、参数 Schema、结果回传 | 查询 Go API |
| MCP | Host/Client/Server、JSON-RPC、Tools/Resources/Prompts、Transport | 后续自研 MCP Server |
| RAG | 解析、切分、Embedding、召回、重排、引用、评测 | 规范与案例检索 |
| 记忆 | 短期状态、长期记忆、写入/更新/过期/冲突 | 项目经验沉淀 |
| Agent 编排 | State、Node、Edge、Reducer、Checkpoint、条件路由 | LangGraph 巡检流程 |
| 子 Agent | 职责边界、委派、结果协议、并行 | 质量/规范/根因/规划 Agent |
| 迭代反思 | 证据校验、重试条件、停止条件 | 诊断复核 |
| HITL | 暂停、审批、拒绝、修改、恢复 | 未来报告确认与审批 |
| 微调 | SFT、LoRA、数据集、验证集、防泄漏 | 缺陷分类实验 |
| 评测 | 检索、工具、任务成功率、轨迹分析 | 回归评测集 |
