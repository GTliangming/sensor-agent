# 09 任务 API 与持久化

## 1. API 建议

- `POST /internal/v1/tasks`：创建任务，返回 `task_id` 和初始状态。
- `GET /internal/v1/tasks/{task_id}`：查询状态、阶段、进度、错误码和结果引用。
- `POST /internal/v1/tasks/{task_id}/cancel`：请求取消（如业务允许）。
- `GET /healthz`：进程健康。
- `GET /readyz`：数据库、工作目录、FFmpeg 等依赖可用性。

接口仅面向受信任的内部调用方；网络隔离或服务间鉴权应由系统边界保证。Python 服务仍要校验请求体和限制资源消耗。

## 2. 任务状态机

```text
queued -> running -> succeeded
                  -> failed
                  -> cancel_requested -> cancelled
```

可选阶段字段：`planning`, `storyboarding`, `asset_search`, `image_generation`, `tts`, `rendering`, `validating`。阶段字段和任务终态分开存储，避免状态语义混乱。

## 3. SQLite 表建议

- `tasks`: task_id、request_id、status、stage、request_json、result_json、error_code、created_at、updated_at。
- `task_events`: event_id、task_id、stage、event_type、payload_json、created_at。
- `agent_runs`: run_id、task_id、agent_name、model_name、prompt_version、input_hash、output_json、status、latency_ms、token_usage、estimated_cost。
- `assets`: asset_id、source_type、source_url、license metadata、content_hash、local_path、media metadata。
- `task_assets`: task_id、scene_id、asset_id、selection_reason。
- `artifacts`: artifact_id、task_id、artifact_type、local_path/object_key、content_hash、metadata_json。

## 4. 幂等与并发

- 用唯一索引约束 `request_id`（若其业务定义是每个请求只创建一次任务）。
- 同一幂等键重复请求应返回已有任务，而不是再次触发模型调用。
- 任务领取与状态更新需使用事务或原子条件更新。
- SQLite 适合本地开发和低并发原型；高并发 worker 可能需要迁移 PostgreSQL 等数据库和独立队列。

## 5. 持久化与检查点的关系

业务数据库记录任务的事实状态和产物引用；LangGraph checkpointer 记录图执行恢复所需状态。二者职责不同。每个阶段成功后先确保产物可访问，再把阶段标记为完成。
