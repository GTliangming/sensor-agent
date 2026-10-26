# 04 多 Agent 架构与协作协议

## 1. 推荐角色（按需启用）

| Agent / 子图 | 负责 | 输入 | 输出 | 不负责 |
|---|---|---|---|---|
| Supervisor / Orchestrator | 决定下一步、读取状态、处理失败分支 | 任务目标、各子图结果 | 下一步路由决策 | 直接剪视频、绕过预算 |
| Creative Agent | 把主题整理为创作 Brief、旁白基调 | 原始主题、风格、受众 | `CreativeBrief` | 选素材、执行 FFmpeg |
| Storyboard Agent | 生成并修订分镜 | Brief、时长、场景限制 | `Storyboard` | 决定超预算继续生成 |
| Asset Agent | 搜索素材、比较语义匹配度和授权元数据 | Storyboard、素材索引 | `AssetPlan` | 把无授权素材标为可商用 |
| Image Fallback Agent | 为缺失场景写图像提示词并请求生成 | 缺口场景、角色参考信息 | 图片资产记录 | 自行决定生成数量上限 |
| Voice Agent | 整理 TTS 文本、音色和节奏配置 | Storyboard | `AudioPlan` / 音频路径 | 改写剧情核心内容 |
| Editing Agent | 产出可执行 RenderPlan | 图片/视频/音频/字幕路径 | `RenderPlan` | 直接执行未经校验的 shell 字符串 |
| Quality Agent | 检查结构、连续性、时长、字幕、素材授权 | 各阶段产物 | `QualityReport` | 随意重写全部结果 |
| Recovery / Retry Policy（普通代码） | 判断是否重试、回滚或终止 | 错误码、次数、预算 | 可执行动作 | 让 LLM 无限重试 |

第一版可先实现 Creative、Storyboard、Asset、Quality 四个逻辑角色；Voice 和 Editing 多数时候应是确定性服务，不需要包装成“会思考的 Agent”。

## 2. Supervisor 不是万能大模型

推荐“代码路由优先，LLM 决策有限”：
- 固定流程由图边决定。
- 只有出现质量不达标、素材缺口、需要返工等分支时，才让 Supervisor 在白名单动作中选择。
- Supervisor 只能返回枚举，例如 `continue`、`revise_storyboard`、`retry_asset_search`、`generate_missing_images`、`fail`。
- 路由前由代码检查预算、状态和重试次数。

禁止让 Supervisor 生成任意 Python、shell 命令或任意节点名称。

## 3. Agent 合约

每个 Agent 采用以下输入输出契约：

```json
{
  "task_id": "task_123",
  "schema_version": "1.0",
  "producer": "storyboard_agent",
  "input_ref": "creative_brief_id",
  "result": {},
  "warnings": []
}
```

建议每个 Agent：
1. 只读取它需要的字段。
2. 只返回自己的结果字段。
3. 不直接修改别的 Agent 的结果。
4. 不直接操作用户积分、鉴权和任务终态。
5. 不保留没有必要的完整聊天历史。
6. 记录模型名、提示词版本、耗时、token/费用和验证结果。

## 4. 避免多 Agent 常见陷阱

- 角色数量不等于能力：多个 Agent 用同一提示词、同一上下文通常只是增加延迟和成本。
- 不允许无边界互相调用：图必须有最大循环次数和截止时间。
- 不把关键规则只写在 Prompt：版权、预算、文件路径、重试上限必须由代码强制。
- 不共享可变大对象：用 schema 化结果交接。
- 不要让每个 Agent 都重新读完整聊天记录；只传 Brief、Storyboard 等最小必要上下文。
- 每个 Agent 必须有单元测试与独立评测样例。
