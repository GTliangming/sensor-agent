import React, { useMemo, useState } from "react";
import "./DebuggerPanel.css";

const filters = [
  { id: "all", label: "全部" },
  { id: "request", label: "HTTP 请求" },
  { id: "response", label: "HTTP 返回" },
  { id: "backend", label: "后端过程" },
  { id: "sse", label: "SSE 事件" },
  { id: "error", label: "错误" }
];

export default function DebuggerPanel({ events, onClear }) {
  const [filter, setFilter] = useState("backend");
  const [selectedId, setSelectedId] = useState(null);
  const graphEvents = events.filter(item => item.type === "backend");
  const lastRunIndex = graphEvents.map(item => item.detail.step).lastIndexOf("run_started");
  const currentRunEvents = lastRunIndex >= 0 ? graphEvents.slice(lastRunIndex) : [];
  const lastGraphEvent = currentRunEvents[currentRunEvents.length - 1];
  const latestNodeEvent = [...currentRunEvents].reverse().find(item => item.detail.step === "node_output_started");
  const graphInputEvent = currentRunEvents.find(item => item.detail.step === "graph_input_prepared");
  const planEvent = currentRunEvents.find(item => item.detail.step === "plan_generated");
  const planReviewEvent = [...currentRunEvents].reverse().find(item => item.detail.step === "plan_review_applied");
  const awaitingPlanEvent = [...currentRunEvents].reverse().find(item => item.detail.step === "awaiting_plan_review");
  const executionEvents = currentRunEvents.filter(item => item.detail.step === "execution_step_completed");
  const executionEvent = executionEvents[executionEvents.length - 1];
  const checkpointEvent = [...currentRunEvents].reverse().find(item => item.detail.step === "checkpoint_saved");
  const stateUpdateEvent = [...currentRunEvents].reverse().find(item => item.detail.step === "checkpoint_updated");
  const actualNode = latestNodeEvent?.detail.node;
  const savedPlanSteps = planEvent?.detail.plan_steps
    || awaitingPlanEvent?.detail.plan_steps
    || planReviewEvent?.detail.existing_plan_steps
    || stateUpdateEvent?.detail.existing_plan_steps
    || [];
  const currentPlanSteps = executionEvents.reduce((steps, event) => (
    steps.map((step, index) => index === event.detail.step_index ? event.detail.plan_step : step)
  ), savedPlanSteps);
  const lastStep = lastGraphEvent?.detail.step;
  const pausedAtPlan = lastStep === "awaiting_plan_review";
  const pausedAtHuman = lastStep === "awaiting_human";
  const finished = lastStep === "run_finished";
  const routing = lastStep === "checkpoint_updated";
  const currentNode = pausedAtPlan
    ? "human_plan_review"
    : pausedAtHuman
      ? "human_feedback"
    : finished
      ? "END"
      : routing
        ? "router"
        : lastStep === "plan_review_applied"
          ? planReviewEvent.detail.state_update?.plan_review_action === "replan" ? "assistant_plan" : "assistant_execute_step"
          : executionEvent
            ? executionEvent.detail.step_index + 1 < executionEvent.detail.total_steps ? "assistant_execute_step" : "assistant_draft"
            : actualNode || (graphInputEvent ? currentPlanSteps.length ? "human_plan_review" : "assistant_plan" : null);
  const chosenBranch = stateUpdateEvent && actualNode
    ? stateUpdateEvent.detail.state_update?.status === "feedback" && actualNode === "assistant_draft"
      ? "feedback"
      : stateUpdateEvent.detail.state_update?.status === "approved" && actualNode === "assistant_finalize"
        ? "approved"
        : null
    : null;
  const runData = currentRunEvents[0]?.detail;
  const activeRequest = graphInputEvent?.detail.human_request;
  const activeState = {
    thread_id: runData?.thread_id,
    run_type: runData?.run_type,
    human_request: activeRequest,
    status: stateUpdateEvent?.detail.state_update?.status || checkpointEvent?.detail.status || null,
    human_comment: stateUpdateEvent?.detail.state_update?.human_comment || null,
    plan: currentPlanSteps.length ? `${currentPlanSteps.length} structured steps` : null,
    step_index: executionEvent?.detail.next_step_index,
    next_nodes: checkpointEvent?.detail.next_nodes || []
  };
  const visibleEvents = useMemo(
    () => events.filter(item => filter === "all" || item.type === filter),
    [events, filter]
  );
  const selectedEvent = visibleEvents.find(item => item.id === selectedId) || visibleEvents[visibleEvents.length - 1];

  return (
    <main className="debugger-page">
      <header className="debugger-header">
        <div>
          <p className="debugger-kicker">LIVE REQUEST INSPECTOR</p>
          <h1>LangGraph 执行与人工干预</h1>
          <p>重点观察图的 State、暂停点和恢复后的实际节点。主图由 Python 预先编排控制流，模型只在节点内生成文本；下面的执行轨迹来自后端实时 trace。</p>
        </div>
        <button className="debug-clear" onClick={onClear} disabled={events.length === 0}>清空记录</button>
      </header>

      <section className="graph-inspector">
        <div className="graph-inspector-heading">
          <div>
            <p className="debugger-kicker">STATEGRAPH · HUMAN-IN-THE-LOOP</p>
            <h2>当前这一轮图执行到哪里</h2>
          </div>
          <span className={`graph-run-state ${pausedAtPlan || pausedAtHuman ? "paused" : finished ? "finished" : currentRunEvents.length ? "running" : "waiting"}`}>
            {pausedAtPlan ? "等待确认计划" : pausedAtHuman ? "等待审核答案" : finished ? "本轮已结束" : currentRunEvents.length ? "运行中 / 最近事件" : "等待开始"}
          </span>
        </div>

        <div className="debug-graph-flow">
          <div className={`debug-graph-node ${currentNode === "START" ? "current" : graphInputEvent ? "visited" : ""}`}>
            <span>入口</span><strong>START</strong>
          </div>
          <span className="debug-graph-arrow">→</span>
          <div className={`debug-graph-node planner ${currentNode === "assistant_plan" ? "current" : planEvent ? "visited" : ""}`}>
            <span>规划节点 · LLM</span><strong>assistant_plan</strong><small>生成结构化步骤</small>
          </div>
          <span className="debug-graph-arrow">→</span>
          <div className={`debug-graph-node human ${currentNode === "human_plan_review" ? "current" : currentPlanSteps.length ? "visited" : ""}`}>
            <span>人工关卡 1</span><strong>human_plan_review</strong><small>确认 / 修改 / 重规划</small>
          </div>
          <span className="debug-graph-arrow">→</span>
          <div className={`debug-graph-node executor ${currentNode === "assistant_execute_step" ? "current" : executionEvent || actualNode === "assistant_draft" || pausedAtHuman || finished ? "visited" : ""}`}>
            <span>逐步执行</span><strong>assistant_execute_step</strong><small>每个步骤单独运行并保存结果</small>
          </div>
          <span className="debug-graph-arrow">→</span>
          <div className={`debug-graph-node model ${currentNode === "assistant_draft" ? "current" : actualNode === "assistant_draft" || pausedAtHuman || finished ? "visited" : ""}`}>
            <span>汇总节点</span><strong>assistant_draft</strong><small>按步骤结果生成回答</small>
          </div>
          <span className="debug-graph-arrow">→</span>
          <div className={`debug-graph-node human ${currentNode === "human_feedback" ? "current" : pausedAtHuman || stateUpdateEvent || finished ? "visited" : ""}`}>
            <span>人工关卡 2</span><strong>human_feedback</strong><small>审核草稿 / 提供修改意见</small>
          </div>
          <span className="debug-graph-arrow">→</span>
          <div className="debug-graph-branches">
            <button
              className={`debug-branch feedback ${chosenBranch === "feedback" ? "chosen" : ""} ${currentNode === "router" && activeState.status === "feedback" ? "pending" : ""}`}
              onClick={() => {
                const event = [...currentRunEvents].reverse().find(item => item.detail.node === "assistant_draft");
                if (event) setSelectedId(event.id);
              }}
            >
              <span>status = feedback</span>
              <strong>回到 assistant_draft</strong>
              <small>{chosenBranch === "feedback" ? "后端 trace 已确认实际进入此节点" : "提交反馈后由 feedback_router 选择"}</small>
            </button>
            <button
              className={`debug-branch approved ${chosenBranch === "approved" ? "chosen" : ""} ${currentNode === "router" && activeState.status === "approved" ? "pending" : ""}`}
              onClick={() => {
                const event = [...currentRunEvents].reverse().find(item => item.detail.node === "assistant_finalize");
                if (event) setSelectedId(event.id);
              }}
            >
              <span>status = approved</span>
              <strong>assistant_finalize → END</strong>
              <small>{chosenBranch === "approved" ? "后端 trace 已确认实际进入此节点" : "批准后润色已确认的草稿"}</small>
            </button>
          </div>
        </div>

        <div className={`graph-plan-output ${currentPlanSteps.length ? "has-plan" : ""}`}>
          <div className="graph-plan-heading">
            <strong>结构化计划与逐步结果 · State.plan_steps</strong>
            <span>{planEvent ? "本轮 planner 实际输出" : currentPlanSteps.length ? "从 checkpoint 恢复" : graphInputEvent ? "规划节点运行中" : "等待请求"}</span>
          </div>
          {currentPlanSteps.length
            ? <ol className="debug-plan-steps">
                {currentPlanSteps.map((step, index) => (
                  <li key={step.id || index} className={`debug-plan-step ${step.status || "pending"}`}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{step.description}</strong>
                      <small>{step.status || "pending"}{step.result ? ` · ${step.result}` : ""}</small>
                    </div>
                  </li>
                ))}
              </ol>
            : <p>发送问题后，assistant_plan 会生成结构化步骤并暂停，等待你确认或编辑。</p>}
        </div>

        <div className="graph-planning-note">
          <strong>计划与控制流是两回事：</strong>
          <span>assistant_plan 负责生成并保存可见的任务步骤；普通边和 feedback_router 仍负责控制节点顺序。LLM 给出计划内容，但不直接选择 LangGraph 下一节点。</span>
        </div>

        <div className="graph-inspector-bottom">
          <div className="graph-current-explanation">
            <span>当前解释</span>
            <strong>
              {pausedAtPlan
                ? "计划已生成；图暂停在 human_plan_review。确认后才逐步执行，也可以编辑步骤或要求模型重新规划。"
                : pausedAtHuman
                ? "草稿已经生成；图在 human_feedback 前暂停，等待你批准或提供反馈。"
                : finished
                  ? "assistant_finalize 已运行完成，图到达 END。"
                  : routing
                    ? `收到 ${activeState.status} 决定，正在通过 feedback_router 继续；等待后端报告实际目标节点。`
                    : lastStep === "plan_review_applied"
                      ? "计划审核决定已写回 checkpoint，开始重新规划或逐步执行。"
                      : executionEvent
                        ? `步骤 ${executionEvent.detail.step_index + 1} / ${executionEvent.detail.total_steps} 已完成，结果已经保存到 State。`
                    : actualNode
                      ? `后端已报告节点 ${actualNode} 开始产出。模型在这个节点里生成内容，图的下一步仍由预设边控制。`
                      : graphInputEvent
                        ? "初始 State 已交给 LangGraph，等待模型节点产出。"
                        : "尚无 LangGraph 轨迹。回到“对话演示”发送问题后，这里会显示真实节点状态。"}
            </strong>
            {runData?.thread_id && <code>thread_id: {runData.thread_id}</code>}
          </div>
          <div className="graph-state-snapshot">
            <span>当前 State 摘要</span>
            <dl>
              <div><dt>status</dt><dd>{activeState.status || "未设置（初次生成）"}</dd></div>
              <div><dt>human_comment</dt><dd>{activeState.human_comment || "无"}</dd></div>
              <div><dt>plan_steps</dt><dd>{activeState.plan || "等待规划节点"}</dd></div>
              <div><dt>step_index</dt><dd>{activeState.step_index === undefined ? "尚未执行" : activeState.step_index}</dd></div>
              <div><dt>next</dt><dd>{activeState.next_nodes.length ? activeState.next_nodes.join(", ") : "运行中 / 尚无 checkpoint 结果"}</dd></div>
            </dl>
          </div>
        </div>

        {activeRequest && <div className="graph-request-context"><strong>本轮输入</strong><span>{activeRequest}</span></div>}
      </section>

      <div className="debug-toolbar">
        <div>
          <p className="debugger-kicker">TRACE TIMELINE · 可点选记录查看完整 payload</p>
          <div className="debug-filters" role="tablist" aria-label="调试记录类型">
          {filters.map(item => (
            <button
              key={item.id}
              className={filter === item.id ? "debug-filter active" : "debug-filter"}
              onClick={() => setFilter(item.id)}
              role="tab"
              aria-selected={filter === item.id}
            >
              {item.label}
              {item.id === "all" && <span>{events.length}</span>}
            </button>
          ))}
          </div>
        </div>
        <span className="debug-privacy">主图的每个节点和分支都由后端 trace 确认；HTTP 详情在筛选器中查看。</span>
      </div>

      {events.length === 0 ? (
        <div className="debug-empty">
          <strong>还没有调试记录</strong>
          <p>切到“对话演示”发送一个问题。随后在这里可以按顺序查看创建请求、SSE 连接、后端节点和审核恢复过程。</p>
        </div>
      ) : (
        <div className="debug-workspace">
          <section className="debug-event-list" aria-label="事件时间线">
            {visibleEvents.length === 0 ? (
              <div className="debug-no-results">当前类型没有记录。</div>
            ) : visibleEvents.map((item, index) => (
              <button
                key={item.id}
                className={`debug-event ${selectedEvent?.id === item.id ? "selected" : ""} type-${item.type}`}
                onClick={() => setSelectedId(item.id)}
              >
                <span className="debug-event-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="debug-event-copy">
                  <span className="debug-event-title">{item.title}</span>
                  <span className="debug-event-meta">{item.time} · {filters.find(option => option.id === item.type)?.label || item.type}</span>
                </span>
                <span className="debug-event-marker" />
              </button>
            ))}
          </section>

          <section className="debug-detail" aria-live="polite">
            {selectedEvent ? (
              <>
                <div className="debug-detail-head">
                  <div>
                    <span className={`debug-type-label type-${selectedEvent.type}`}>
                      {filters.find(option => option.id === selectedEvent.type)?.label || selectedEvent.type}
                    </span>
                    <h2>{selectedEvent.title}</h2>
                  </div>
                  <time>{selectedEvent.time}</time>
                </div>
                {selectedEvent.description && <p className="debug-description">{selectedEvent.description}</p>}
                <h3>数据详情</h3>
                <pre className="debug-json"><code>{JSON.stringify(selectedEvent.detail, null, 2)}</code></pre>
                {selectedEvent.source && <p className="debug-source">处理位置：<code>{selectedEvent.source}</code></p>}
              </>
            ) : (
              <div className="debug-no-results">没有可显示的记录。</div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
