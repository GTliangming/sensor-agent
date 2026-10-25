import React, { useState } from "react";
import "./FlowGuide.css";

const stages = [
  {
    id: "submit",
    title: "1. 用户提交问题",
    actor: "浏览器 / React",
    endpoint: "handleStart()",
    summary: "页面先切到等待状态，再把输入框内容交给 AssistantService。此时还没有调用模型。",
    request: `const data = await AssistantService.createStreamingConversation(question);
setThreadId(data.thread_id);
AssistantService.streamResponse(data.thread_id, onMessage, onError, onComplete);`,
    response: "本地 UI: uiState = waiting",
    color: "blue"
  },
  {
    id: "create",
    title: "2. 创建会话 ID",
    actor: "FastAPI 路由",
    endpoint: "POST /graph/stream/create",
    summary: "Pydantic 校验 StartRequest。路由生成 UUID，把启动请求写入 SQLite pending_runs，然后返回 thread_id。这里不跑图、不请求 LLM。",
    request: `{
  "human_request": "解释什么是 HITL"
}`,
    response: `{
  "thread_id": "a UUID",
  "run_status": "pending",
  "assistant_response": null
}`,
    color: "teal"
  },
  {
    id: "connect",
    title: "3. 建立 SSE 连接",
    actor: "浏览器 EventSource",
    endpoint: "GET /graph/stream/{thread_id}",
    summary: "前端用刚拿到的 thread_id 打开持续连接。后端从 SQLite 取回待运行请求，并用这个 ID 定位 SQLite LangGraph checkpoint。",
    request: `const eventSource = new EventSource(
  "http://localhost:8000/graph/stream/" + thread_id
);`,
    response: `config = {
  "configurable": {"thread_id": thread_id}
}
input_state = {"human_request": question}`,
    color: "teal"
  },
  {
    id: "plan",
    title: "4. 后端生成结构化计划",
    actor: "LangGraph + LLM",
    endpoint: "START -> assistant_plan",
    summary: "assistant_plan 要求模型输出 JSON steps 数组，后端校验步骤数量和文本长度，格式不合法会再请求一次。计划作为结构化数据保存到 State.plan_steps，不包含隐藏思维链。",
    request: `plan = model.invoke([
  SystemMessage("只输出 JSON steps 数组"),
  HumanMessage(planning_context)
])
plan_steps = validate_json_plan(plan.content)
return {"plan_steps": plan_steps}`,
    response: `State.plan_steps = [
  {id, description, status: "pending", result: null},
  ...
]

普通边继续到 human_plan_review`,
    color: "blue"
  },
  {
    id: "plan-review",
    title: "5. 人工审核计划",
    actor: "人工 + FastAPI",
    endpoint: "POST /graph/stream/plan-review",
    summary: "图在 human_plan_review 之前暂停。你可以编辑/增删步骤后批准，或填写意见让 assistant_plan 重新规划。计划批准和答案批准使用不同接口与状态。",
    request: `{
  "thread_id": "同一 UUID",
  "plan_action": "approved",
  "plan_steps": [
    {"description": "检查请求"},
    {"description": "整理结果"}
  ]
}`,
    response: `graph.update_state(config, {
  "plan_review_action": "approved",
  "plan_steps": validated_steps,
  "step_index": 0
})`,
    color: "orange"
  },
  {
    id: "draft",
    title: "6. 按步骤执行并汇总",
    actor: "LangGraph + LLM",
    endpoint: "assistant_execute_step -> assistant_draft",
    summary: "执行节点每次只处理 plan_steps[step_index]，把每一步的结果或失败原因写回 State，再移动到下一步。全部步骤结束后 assistant_draft 才汇总为回答。",
    request: `step = state["plan_steps"][step_index]
result = model.invoke(step_prompt)
step["status"] = "completed"
step["result"] = result.content
return {
  **state,
  "plan_steps": updated_steps,
  "step_index": step_index + 1
}`,
    response: "每步产生 execution_step_completed trace；循环结束后生成 draft token",
    color: "purple"
  },
  {
    id: "review",
    title: "7. 暂停审核答案",
    actor: "LangGraph interrupt",
    endpoint: "interrupt_before=human_feedback",
    summary: "草稿节点后，图在 human_feedback 之前暂停并保存 checkpoint。后端发现 next 包含 human_feedback，就发 status=user_feedback，前端展示“批准 / 提供反馈”。",
    request: `graph = builder.compile(
  interrupt_before=[
    "human_plan_review",
    "human_feedback"
  ],
  checkpointer=sqlite_checkpointer
)`,
    response: `SSE event: status
data: {"status":"user_feedback"}`,
    color: "orange"
  },
  {
    id: "resume",
    title: "8. 审核答案后恢复",
    actor: "FastAPI + LangGraph",
    endpoint: "POST resume -> GET SSE",
    summary: "前端提交 approved 或 feedback。POST 路由暂存决定；再次连接 GET 后，后端用 thread_id 定位 checkpoint，update_state 写入决定，再从暂停处继续。",
    request: `{
  "thread_id": "同一 UUID",
  "review_action": "feedback",
  "human_comment": "改成一句话"
}

graph.update_state(config, {
  "status": review_action,
  "human_comment": human_comment
})`,
    response: "approved -> assistant_finalize -> END\nfeedback -> assistant_draft -> 再次等待审核",
    color: "green"
  }
];

function CodeBlock({ children }) {
  return <pre className="guide-code"><code>{children}</code></pre>;
}

export default function FlowGuide() {
  const [selectedStage, setSelectedStage] = useState("submit");
  const [selectedPath, setSelectedPath] = useState("feedback");
  const stage = stages.find(item => item.id === selectedStage);

  return (
    <main className="guide-page">
      <header className="guide-header">
        <div>
          <p className="guide-eyebrow">LANGGRAPH HITL · 实际运行链路</p>
          <h1>一个问题如何变成一条 Agent 流程</h1>
          <p className="guide-lead">
            从 React 发出请求开始，跟踪 FastAPI 如何接收、LangGraph 如何保存状态与暂停，
            再看审核结果怎样让同一条流程继续运行。
          </p>
        </div>
        <div className="guide-live-label">
          <span className="guide-live-dot" />
          当前主页面：计划审核 + 逐步执行 + 答案审核
        </div>
      </header>

      <section className="guide-section" aria-labelledby="flow-title">
        <div className="guide-section-heading">
          <div>
            <p className="guide-kicker">REQUEST LIFECYCLE</p>
            <h2 id="flow-title">请求链路时间线</h2>
          </div>
          <p>选择任意阶段，查看请求内容、对应代码和阶段结果。</p>
        </div>

        <div className="guide-timeline" role="tablist" aria-label="请求阶段">
          {stages.map((item, index) => (
            <React.Fragment key={item.id}>
              <button
                className={`timeline-step ${selectedStage === item.id ? "selected" : ""}`}
                onClick={() => setSelectedStage(item.id)}
                role="tab"
                aria-selected={selectedStage === item.id}
              >
                <span className={`timeline-number ${item.color}`}>{String(index + 1).padStart(2, "0")}</span>
                <span className="timeline-title">{item.title.replace(/^\d+\.\s*/, "")}</span>
                <span className="timeline-actor">{item.actor}</span>
              </button>
              {index < stages.length - 1 && <span className="timeline-connector" aria-hidden="true" />}
            </React.Fragment>
          ))}
        </div>

        <div className="stage-detail" role="tabpanel">
          <div className="stage-detail-copy">
            <span className={`stage-tag ${stage.color}`}>{stage.actor}</span>
            <h3>{stage.title}</h3>
            <p>{stage.summary}</p>
            <div className="endpoint-line">
              <span>入口 / 节点</span>
              <code>{stage.endpoint}</code>
            </div>
          </div>
          <div className="stage-code-columns">
            <div>
              <h4>{selectedStage === "create" || selectedStage === "resume" ? "请求 / 状态更新" : "关键代码"}</h4>
              <CodeBlock>{stage.request}</CodeBlock>
            </div>
            <div>
              <h4>返回 / 下一步</h4>
              <CodeBlock>{stage.response}</CodeBlock>
            </div>
          </div>
        </div>
      </section>

      <section className="guide-section">
        <div className="guide-section-heading">
          <div>
            <p className="guide-kicker">LANGGRAPH STATE MACHINE</p>
            <h2>图的节点是代码函数，边决定运行顺序</h2>
          </div>
          <p>模型生成内容，图管理流程；这两件事不要混为一谈。</p>
        </div>
        <div className="graph-track">
          <div className="graph-node start-node"><span>入口</span><strong>START</strong></div>
          <span className="graph-arrow">→</span>
          <div className="graph-node planner-node"><span>规划节点</span><strong>assistant_plan</strong><small>写入 State.plan_steps</small></div>
          <span className="graph-arrow">→</span>
          <div className="graph-node human-node"><span>计划审核</span><strong>human_plan_review</strong><small>计划前暂停</small></div>
          <span className="graph-arrow">→</span>
          <div className="graph-node executor-node"><span>步骤执行</span><strong>assistant_execute_step</strong><small>循环执行并记录结果</small></div>
          <span className="graph-arrow">→</span>
          <div className="graph-node model-node"><span>模型节点</span><strong>assistant_draft</strong><small>model.invoke(messages)</small></div>
          <span className="graph-arrow">→</span>
          <div className="graph-node human-node"><span>人工关卡</span><strong>human_feedback</strong><small>节点前暂停</small></div>
          <span className="graph-arrow branch-arrow">→</span>
          <div className="graph-branches">
            <button className={selectedPath === "feedback" ? "branch-card active feedback-path" : "branch-card feedback-path"} onClick={() => setSelectedPath("feedback")}>
              <span>review_action = feedback</span>
              <strong>回到 assistant_draft</strong>
              <small>把 human_comment 放进提示词，重新生成</small>
            </button>
            <button className={selectedPath === "approved" ? "branch-card active approved-path" : "branch-card approved-path"} onClick={() => setSelectedPath("approved")}>
              <span>review_action = approved</span>
              <strong>进入 assistant_finalize</strong>
              <small>润色已批准草稿，然后到 END</small>
            </button>
          </div>
        </div>
        <div className="route-explainer">
          <strong>{selectedPath === "feedback" ? "反馈路径" : "批准路径"}：这是代码根据状态做的确定性分支。</strong>
          <code>{selectedPath === "feedback" ? "feedback_router(state) -> assistant_draft" : "feedback_router(state) -> assistant_finalize -> END"}</code>
        </div>
      </section>

      <section className="guide-two-column">
        <article className="guide-section planner-section">
          <p className="guide-kicker">WHAT “PLANNING” MEANS HERE</p>
          <h2>计划经过人工确认后逐步执行</h2>
          <p className="section-intro">assistant_plan 生成经过 JSON 校验的步骤，先暂停让人确认或修改；assistant_execute_step 一步一步运行并记录结果，再交给 assistant_draft 汇总。</p>
          <div className="responsibility-row">
            <span className="responsibility-label">LangGraph / Python</span>
            <p>按固定边运行规划、计划审核、步骤执行和答案审核；feedback_router 根据 status 选择反馈重写或批准定稿。</p>
          </div>
          <div className="responsibility-row model-responsibility">
            <span className="responsibility-label">LLM / DeepSeek</span>
            <p>生成结构化计划，并分别为每个步骤生成结果。它仍不直接决定图的下一节点，也不执行没有工具支持的外部操作。</p>
          </div>
          <div className="responsibility-row human-responsibility">
            <span className="responsibility-label">人</span>
            <p>选择 approved 或 feedback；这个决定写入图状态，控制后续分支。</p>
          </div>
          <div className="code-reference">
            <code>add_edge(START, "assistant_plan")</code>
            <code>interrupt_before=["human_plan_review", "human_feedback"]</code>
            <code>add_conditional_edges("assistant_execute_step", execution_router, ...)</code>
            <code>add_conditional_edges("human_feedback", feedback_router, ...)</code>
          </div>
        </article>

        <article className="guide-section state-section">
          <p className="guide-kicker">STATE & CHECKPOINT</p>
          <h2>thread_id 是跨 HTTP 请求的关联键</h2>
          <p className="section-intro">前端每次继续对话都带回同一个 ID。LangGraph 用它找回暂停时的 State，而不是靠浏览器记住整个后端流程。</p>
          <div className="state-fields">
            <div><code>human_request</code><span>最初的问题</span></div>
            <div><code>plan_steps</code><span>步骤、状态、执行结果和错误</span></div>
            <div><code>step_index</code><span>当前执行步骤位置</span></div>
            <div><code>messages</code><span>对话消息历史</span></div>
            <div><code>assistant_response</code><span>当前草稿或定稿</span></div>
            <div><code>status</code><span>approved / feedback</span></div>
            <div><code>human_comment</code><span>用户的修改意见</span></div>
          </div>
          <div className="memory-note"><strong>当前实现注意：</strong>checkpoint 和待处理请求保存在本地 SQLite，后端重启后可恢复。数据库含用户输入、计划和模型结果，当前未加密或自动过期；生产环境需配置访问控制、备份和保留策略。</div>
        </article>
      </section>

      <section className="guide-section sse-section">
        <div className="guide-section-heading">
          <div>
            <p className="guide-kicker">SERVER-SENT EVENTS</p>
            <h2>SSE 如何把后端进度送回浏览器</h2>
          </div>
          <p>浏览器保持 GET 连接打开，后端以事件帧不断写回数据。</p>
        </div>
        <div className="sse-events">
          <div><span className="event-pill event-start">start / resume</span><p>表示本次图运行开始或从 checkpoint 续跑。</p></div>
          <div><span className="event-pill event-token">token</span><p>携带 assistant 节点产生的文本片段，前端拼接到回答里。</p></div>
          <div><span className="event-pill event-status">status</span><p><code>user_feedback</code> 显示审核操作；<code>finished</code> 表示结束。</p></div>
          <div><span className="event-pill event-error">error</span><p>服务端异常事件。注意：前端目前主要处理 EventSource 连接级错误。</p></div>
        </div>
        <div className="sse-caveat"><strong>关于“逐 token”：</strong>后端把 LangGraph 的 message stream 编成 SSE，但图节点调用的是 <code>model.invoke()</code>。因此不保证模型每生成一个 token 就立即发送，可能是节点生成完一段后再推送。</div>
      </section>

      <section className="guide-section mcp-section">
        <div>
          <p className="guide-kicker">A SEPARATE ROUTE IN THIS REPO</p>
          <h2>另一条路由才是 MCP 工具 Agent</h2>
          <p>独立的 <code>/mcp/start</code> 接口用 <code>create_react_agent</code> 注册模型和 MCP 工具。模型可以在 ReAct 循环里决定是否调用工具；工具真正执行前，<code>interrupt()</code> 会要求人工批准。</p>
        </div>
        <div className="mcp-flow">
          <span>用户请求</span><b>→</b><span>ReAct 模型判断</span><b>→</b><span>提出工具调用</span><b>→</b><span>人工批准</span><b>→</b><span>运行 MCP 工具</span>
        </div>
        <div className="mcp-note">它也没有显式“先写计划清单”的 Planner 节点；并且当前聊天页面调用的是 <code>/graph/stream/*</code>，不是这条 MCP 路由。</div>
      </section>

      <footer className="guide-footer">
        <span>代码入口</span>
        <a href="https://github.com/GTliangming/sensor-agent/blob/main/langgraph-hitl-fastapi-demo/frontend/src/App.js" target="_blank" rel="noreferrer">frontend/src/App.js</a>
        <a href="https://github.com/GTliangming/sensor-agent/blob/main/langgraph-hitl-fastapi-demo/backend/app/lesson_02_streaming.py" target="_blank" rel="noreferrer">backend/app/lesson_02_streaming.py</a>
        <a href="https://github.com/GTliangming/sensor-agent/blob/main/langgraph-hitl-fastapi-demo/backend/app/graph.py" target="_blank" rel="noreferrer">backend/app/graph.py</a>
      </footer>
    </main>
  );
}
