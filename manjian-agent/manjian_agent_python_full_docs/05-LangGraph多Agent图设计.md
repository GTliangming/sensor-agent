# 05 LangGraph 多 Agent 图设计

## 1. 推荐结构：主图 + 有边界的子图

```text
START
  -> intake_node
  -> creative_subgraph
  -> storyboard_subgraph
  -> asset_subgraph
  -> [if gaps and budget allows] image_fallback_subgraph
  -> voice_service_node
  -> render_service_node
  -> quality_subgraph
  -> quality_router
       -> PASS: persist_success -> END
       -> STORYBOARD_ISSUE: storyboard_subgraph (最多 1 次返工)
       -> ASSET_ISSUE: asset_subgraph (最多 1 次重检)
       -> TECHNICAL_ISSUE: recovery_node (有限重试)
       -> FAIL: persist_failure -> END
```

注意：子图不一定都需要 LLM。TTS、FFmpeg、文件验证可以是普通节点。

## 2. State 分层

建议把状态分为三层：

1. **主图共享状态**：`task_id`、`request`、当前阶段、预算、各阶段产物 ID、错误列表。
2. **子图私有状态**：Agent 内部的临时候选、模型修复过程、局部评分。
3. **持久化记录**：数据库中任务、阶段事件、模型调用、资产和最终结果。

不要把所有候选素材、base64 图片、完整供应商响应放到主图 State。文件放磁盘/对象存储，数据库存引用。

## 3. Reducer 策略示例

- `storyboard`: replace
- `asset_plan`: replace
- `retry_counts`: 按 key 更新，避免整个对象被意外覆盖
- `errors`: append reducer
- `events`: append reducer（注意事件 ID 去重）
- `budget_remaining`: 不要用多个并行 Agent 直接无锁扣减；用数据库事务或串行预算节点。

多 Agent 并行执行前，先确保它们不会同时写同一个 State key。并行适合“不同场景的独立素材搜索”，但预算扣减和任务状态转移应由统一协调点处理。

## 4. 路由结果必须受控

定义枚举：

```python
from enum import StrEnum

class RouteDecision(StrEnum):
    CONTINUE = "continue"
    REVISE_STORYBOARD = "revise_storyboard"
    RETRY_ASSET_SEARCH = "retry_asset_search"
    GENERATE_MISSING_IMAGES = "generate_missing_images"
    FAIL = "fail"
```

Supervisor 的输出经过 Pydantic 校验后，再由普通代码确认：
- 当前状态是否允许此动作；
- 是否超过重试次数；
- 是否超时；
- 图片/文本调用预算是否足够；
- 相关素材是否具有可验证的使用权。

## 5. 检查点与恢复

LangGraph checkpointer 可保存图状态，但它不替代业务数据库。业务任务表仍是任务状态的权威来源。建议：
- 每个阶段成功后先写阶段产物和事件，再更新任务阶段；
- 需要恢复时从最近的已完成阶段继续；
- 外部副作用（图像生成、TTS、上传）使用幂等键；
- 不要仅凭“图状态里有结果”就认为文件一定还存在，恢复时要重新验证文件。

## 6. 建议的实现顺序

1. 先用单图实现每个节点和 Schema。
2. 把 `storyboard`、`asset_plan`、`quality_report` 的输入输出固定下来。
3. 把节点包装成独立子图。
4. 最后才加入 Supervisor 的有限路由。
5. 对比拆分前后的质量、成本、耗时。没有收益就保留单图。
