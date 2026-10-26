# 03 单 Agent 工作流：先把业务链路跑通

这里的“单 Agent”不是只有一个函数，而是一个 LangGraph 主图管理一组确定性节点。每个节点可以调用模型，也可以不调用模型。

## 1. 主流程

```text
START
 -> validate_request
 -> generate_storyboard
 -> validate_storyboard
 -> retrieve_assets
 -> plan_missing_assets
 -> generate_missing_images (if needed)
 -> synthesize_tts
 -> build_subtitles
 -> render_video
 -> validate_output
 -> save_result
 -> END
```

失败路径要显式定义：
- 模型输出不合法：最多修复/重试 N 次，然后失败并保留原始响应摘要。
- 素材不够：先降低镜头复杂度或使用授权替代素材；仍不够则给出明确失败原因。
- 图像生成失败：按预算重试；超过预算则标记场景失败，不要无限循环。
- TTS 失败：可重试；不能默默用空音频继续。
- FFmpeg 失败：保留命令参数、退出码和 stderr 摘要，避免记录 API Key 或用户敏感信息。

## 2. State 设计原则

共享 State 只存跨节点必须传递的数据，不要塞入完整视频二进制或过大的模型历史。

```python
from typing import TypedDict, NotRequired, Any

class AgentState(TypedDict):
    task_id: str
    request: dict
    storyboard: NotRequired[dict]
    asset_plan: NotRequired[dict]
    audio_plan: NotRequired[dict]
    render_plan: NotRequired[dict]
    quality_report: NotRequired[dict]
    errors: NotRequired[list[dict]]
    retry_counts: NotRequired[dict[str, int]]
    status: str
```

实际 LangGraph 中，`errors` 若需累积，应定义 reducer；其他结构化对象通常是 replace 更新。不要把大文件内容放进 State，只传路径、对象存储 key 或数据库 ID。

## 3. 哪些环节必须普通代码控制

- 输入边界与配额
- 最大场景数、最大图片数、最大重试数
- 文件存在性、媒体时长、分辨率、音轨检查
- 授权状态检查
- 任务状态转移
- 幂等、锁、超时和取消
- FFmpeg 调用
- 数据库写入

## 4. 何时升级多 Agent

当出现下列至少一项，再拆独立 Agent：
- 分镜创作需要不同提示词、工具或单独评测；
- 素材检索有独立搜索工具和复杂授权判定；
- 质检需要多轮诊断与定向返工；
- 各能力需要独立版本、限流、缓存或模型；
- 单一节点的提示词/状态已经难以维护。

不要仅仅因为“Agent 热门”就拆分。
