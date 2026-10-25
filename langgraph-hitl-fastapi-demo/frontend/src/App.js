import React, { useState, useRef, useEffect } from "react";
import AssistantService from "./AssistantService";
import ReactMarkdown from "react-markdown";
import FlowGuide from "./FlowGuide";
import DebuggerPanel from "./DebuggerPanel";
import "./PlanReview.css";

// 开关：true 用流式接口（SSE，逐字显示），false 用阻塞接口（一次返回完整结果）
const USE_STREAMING = true;

const App = () => {
  const [activeView, setActiveView] = useState("demo");
  const [debugEvents, setDebugEvents] = useState([]);
  const debugSequenceRef = useRef(0);
  // 界面状态机，共四种：idle（空闲/展示审批按钮）、waiting（等待后端）、
  // user_feedback（填写反馈）、finished（已批准，展示最终答案）
  const [uiState, setUiState] = useState("idle");
  const [question, setQuestion] = useState("");            // 用户输入的问题
  const [assistantResponse, setAssistantResponse] = useState(""); // AI 当前回答
  const [feedback, setFeedback] = useState("");            // 用户填写的反馈
  const [planSteps, setPlanSteps] = useState([]);
  const [planFeedback, setPlanFeedback] = useState("");
  const [threadId, setThreadId] = useState(null);          // 后端会话 ID，用于续接同一轮对话
  const [history, setHistory] = useState([]);              // 对话记录数组 [{role, content}]

  // useRef 存流式累加的文本：直接改 .current 不会触发重渲染，适合在回调里累加 token
  const startAccumulatedResponseRef = useRef("");
  const approveAccumulatedResponseRef = useRef("");
  const feedbackAccumulatedResponseRef = useRef("");

  // 反馈输入框的引用，用于自动聚焦
  const feedbackInputRef = useRef(null);
  const recordDebugEvent = (type, title, detail, description, source) => {
    debugSequenceRef.current += 1;
    setDebugEvents(previous => [...previous, {
      id: debugSequenceRef.current,
      type,
      title,
      detail,
      description,
      source,
      time: new Date().toLocaleTimeString()
    }]);
  };
  const recordTrace = (trace) => {
    if (trace.type === "connection") {
      recordDebugEvent(
        "request",
        `${trace.method} /graph/stream/${trace.thread_id}`,
        trace,
        "浏览器建立 SSE 长连接。连接保持打开，接下来接收后端事件。",
        "frontend/src/AssistantService.js"
      );
    } else if (trace.type === "backend") {
      const source = trace.data.node
        ? "backend/app/graph.py"
        : "backend/app/lesson_02_streaming.py";
      recordDebugEvent(
        "backend",
        trace.data.step,
        trace.data,
        trace.data.explanation,
        source
      );
    } else if (trace.type === "sse") {
      recordDebugEvent(
        "sse",
        trace.event === "token" ? "收到模型文本片段" : `收到 SSE: ${trace.event}`,
        trace.data,
        "这是浏览器实际收到并解析的服务端事件。",
        "frontend/src/AssistantService.js"
      );
    } else if (trace.type === "parse_error") {
      recordDebugEvent("error", "解析 SSE trace 失败", trace, null, "frontend/src/AssistantService.js");
    }
  };
  // 进入「填写反馈」状态时，自动把光标聚焦到反馈框
  // 注意：状态名是 "user_feedback"（原代码误写成 "feedback_form"，导致自动聚焦从未生效，已修复）
  useEffect(() => {
    if (uiState === "user_feedback" && feedbackInputRef.current) {
      feedbackInputRef.current.focus();
    }
  }, [uiState]);
  
  // 提交处理函数

  // 发起提问：新建一轮对话
  const handleStart = async () => {
    // 立刻显示用户消息和「等待中」转圈
    setUiState("waiting");
    setHistory([
      { role: "user", content: question },
      { role: "assistant", content: null } // content 为 null 表示该条正在加载（显示转圈）
    ]);

    try {
      if (!USE_STREAMING) {
        // 阻塞接口：一次性等完整返回
        const data = await AssistantService.startConversation(question);
        setThreadId(data.thread_id);
        if (data.run_status === "plan_review") {
          setPlanSteps(data.plan_steps || []);
          setHistory([
            { role: "user", content: question },
            { role: "assistant", content: "执行计划已生成，等待你确认或调整。" }
          ]);
          setUiState("plan_review");
        } else {
          setAssistantResponse(data.assistant_response);
          setUiState(data.run_status === "finished" ? "finished" : "idle");
          setHistory([
            { role: "user", content: question },
            { role: "assistant", content: data.assistant_response }
          ]);
        }
      } else {
        // 流式接口：先建会话拿到 thread_id，再用 SSE 逐字接收
        recordDebugEvent(
          "request",
          "POST /graph/stream/create",
          { method: "POST", url: "http://localhost:8000/graph/stream/create", body: { human_request: question } },
          "前端提交问题。这个请求只创建 thread_id 并暂存问题，不会调用模型。",
          "frontend/src/AssistantService.js"
        );
        const data = await AssistantService.createStreamingConversation(question, (response) => {
          recordDebugEvent(
            "response",
            `POST /graph/stream/create · HTTP ${response.status}`,
            response,
            "FastAPI 返回 thread_id；之后的 SSE 请求会使用这个 ID。",
            "backend/app/lesson_02_streaming.py"
          );
        });
        setThreadId(data.thread_id);

        // 先清空回答，后面逐 token 累加
        setAssistantResponse("");

        // 重置本轮累加用的 ref
        startAccumulatedResponseRef.current = "";

        // 开始接收流式响应
        const eventSource = AssistantService.streamResponse(
          data.thread_id,
          // 消息回调：处理收到的 token
          (data) => {
            if (data.content) {
              // 把新内容累加到 ref
              startAccumulatedResponseRef.current += data.content;

              // 用累加后的内容更新 React 状态
              setAssistantResponse(startAccumulatedResponseRef.current);

              // 同步更新对话记录里的最新回答
              setHistory([
                { role: "user", content: question },
                { role: "assistant", content: startAccumulatedResponseRef.current }
              ]);
            } else if (data.status) {
              // 根据状态更新界面
              if (data.status === "plan_review") {
                setPlanSteps(data.plan_steps || []);
                setPlanFeedback("");
                setHistory([
                  { role: "user", content: question },
                  { role: "assistant", content: "执行计划已生成，等待你确认或调整。" }
                ]);
                setUiState("plan_review");
              } else if (data.status === "user_feedback") {
                setUiState("idle"); // 展示审批按钮
              } else if (data.status === "finished") {
                setUiState("finished");
              }
            }
          },
          // 错误回调
          (error) => {
            console.error("流式传输出错:", error);
            recordDebugEvent("error", "SSE 连接错误", { message: error?.message || String(error) }, null, "frontend/src/AssistantService.js");
            setUiState("idle");
            // 使用前先判断 error 是否有 message 属性
            const errorMessage = error && error.message ? error.message : "未知错误";
            alert("流式传输出错：" + errorMessage);
          },
          // 完成回调
          () => {
            console.log("流式传输结束");
            // 最终的记录更新已在消息回调里处理
          },
          recordTrace
        );
      }
    } catch (err) {
      recordDebugEvent("error", "发起对话失败", { message: err.message }, null, "frontend/src/App.js");
      setAssistantResponse("");
      setUiState("idle");
      // 使用前先判断 err 是否有 message 属性
      const errorMessage = err && err.message ? err.message : "未知错误";
      alert("连接后端失败：" + errorMessage);
    }
  };

  const handlePlanReview = async (planAction) => {
    setUiState("waiting");
    const payload = {
      thread_id: threadId,
      plan_action: planAction,
      plan_steps: planAction === "approved"
        ? planSteps.map(step => ({ description: step.description }))
        : [],
      plan_feedback: planAction === "replan" ? planFeedback : null
    };

    recordDebugEvent(
      "request",
      `POST /graph/stream/plan-review · ${planAction}`,
      { method: "POST", url: "http://localhost:8000/graph/stream/plan-review", body: payload },
      "独立的计划审核请求。approved 会执行当前步骤；replan 会带着补充意见重新规划。",
      "frontend/src/AssistantService.js"
    );

    try {
      if (!USE_STREAMING) {
        const result = await AssistantService.submitPlanReviewBlocking(payload);
        setPlanSteps(result.plan_steps || planSteps);
        if (result.run_status === "plan_review") {
          setUiState("plan_review");
          return;
        }
        setAssistantResponse(result.assistant_response || "");
        setHistory([
          { role: "user", content: question },
          { role: "assistant", content: result.assistant_response || "" }
        ]);
        setUiState(result.run_status === "finished" ? "finished" : "idle");
        return;
      }

      const response = await AssistantService.submitPlanReview(payload, (result) => {
        recordDebugEvent(
          "response",
          `POST /graph/stream/plan-review · HTTP ${result.status}`,
          result,
          "后端已记录计划审核决定，接下来通过同一个 thread_id 恢复 LangGraph。",
          "backend/app/lesson_02_streaming.py"
        );
      });
      if (planAction === "approved") {
        startAccumulatedResponseRef.current = "";
        setAssistantResponse("");
        setHistory(previous => [
          ...previous.filter((item, index) => !(index === previous.length - 1 && item.role === "assistant")),
          { role: "assistant", content: null }
        ]);
      }

      AssistantService.streamResponse(
        response.thread_id,
        (message) => {
          if (message.content) {
            startAccumulatedResponseRef.current += message.content;
            setAssistantResponse(startAccumulatedResponseRef.current);
            setHistory(previous => [
              ...previous.slice(0, -1),
              { role: "assistant", content: startAccumulatedResponseRef.current }
            ]);
          } else if (message.status === "plan_review") {
            setPlanSteps(message.plan_steps || []);
            setPlanFeedback("");
            setUiState("plan_review");
          } else if (message.status === "user_feedback") {
            setUiState("idle");
          } else if (message.status === "finished") {
            setUiState("finished");
          }
        },
        (error) => {
          recordDebugEvent("error", "计划执行 SSE 错误", { message: error?.message || String(error) }, null, "frontend/src/AssistantService.js");
          setUiState(planAction === "replan" ? "plan_review" : "idle");
        },
        () => {},
        recordTrace
      );
    } catch (error) {
      recordDebugEvent("error", "计划审核请求失败", { message: error.message }, null, "frontend/src/App.js");
      setUiState("plan_review");
    }
  };

  // 批准：认可当前回答，让流程走向结束
  const handleApprove = async () => {
    setUiState("waiting");
    setHistory([...history, { role: "assistant", content: null }]); // 显示转圈
    
    try {
      if (!USE_STREAMING) {
        // 阻塞接口
        const data = await AssistantService.submitReview({
          thread_id: threadId,
          review_action: "approved"
        });
        setAssistantResponse(data.assistant_response);
        setUiState("finished"); // 批准后进入「已完成」状态
        // 用真实回答替换掉最后一条（转圈占位）
        setHistory(prev => [
          ...prev.slice(0, -1),
          { role: "assistant", content: data.assistant_response }
        ]);
      } else {
        // 流式接口
        const resumePayload = {
          thread_id: threadId,
          review_action: "approved"
        };
        recordDebugEvent(
          "request",
          "POST /graph/stream/resume · approved",
          { method: "POST", url: "http://localhost:8000/graph/stream/resume", body: resumePayload },
          "前端提交批准决定；此 POST 只暂存决定，后端随后通过新的 SSE GET 恢复图。",
          "frontend/src/AssistantService.js"
        );
        const data = await AssistantService.resumeStreamingConversation(resumePayload, (response) => {
          recordDebugEvent("response", `POST /graph/stream/resume · HTTP ${response.status}`, response, "后端已接收决定，run_status 为 pending。", "backend/app/lesson_02_streaming.py");
        });
        
        // 清空回答，准备逐 token 累加
        setAssistantResponse("");
        
        // 重置本轮累加用的 ref
        approveAccumulatedResponseRef.current = "";
        
        // 开始接收流式响应
        const eventSource = AssistantService.streamResponse(
          threadId,
          // 消息回调：处理收到的 token
          (data) => {
            if (data.content) {
              // 累加新内容到 ref
              approveAccumulatedResponseRef.current += data.content;
              
              // 更新 React 状态
              setAssistantResponse(approveAccumulatedResponseRef.current);
              
              // 用当前累加内容替换转圈占位条
              setHistory(prev => [
                ...prev.slice(0, -1),
                { role: "assistant", content: approveAccumulatedResponseRef.current }
              ]);
            } else if (data.status) {
              // 根据状态更新界面
              if (data.status === "plan_review") {
                setPlanSteps(data.plan_steps || []);
                setPlanFeedback("");
                setUiState("plan_review");
              } else if (data.status === "finished") {
                setUiState("finished");
              }
            }
          },
          // 错误回调
          (error) => {
            console.error("流式传输出错:", error);
            recordDebugEvent("error", "SSE 连接错误", { message: error?.message || String(error) }, null, "frontend/src/AssistantService.js");
            setUiState("idle");
            // 使用前先判断 error 是否有 message 属性
            const errorMessage = error && error.message ? error.message : "未知错误";
            alert("流式传输出错：" + errorMessage);
          },
          // 完成回调
          () => {
            console.log("流式传输结束");
            // 最终的记录更新已在消息回调里处理
          },
          recordTrace
        );
      }
    } catch (err) {
      recordDebugEvent("error", "批准流程失败", { message: err.message }, null, "frontend/src/App.js");
      setUiState("idle");
      // 使用前先判断 err 是否有 message 属性
      const errorMessage = err && err.message ? err.message : "未知错误";
      alert("连接后端失败：" + errorMessage);
    }
  };

  // 提交反馈：把修改意见交给 AI，让它重新生成回答
  const handleFeedback = async () => {
    setUiState("waiting");
    setHistory([
      ...history,
      { role: "user", content: feedback },
      { role: "assistant", content: null }
    ]); // 提交反馈后显示转圈
    
    try {
      if (!USE_STREAMING) {
        // 阻塞接口
        const data = await AssistantService.submitReview({
          thread_id: threadId,
          review_action: "feedback",
          human_comment: feedback
        });
        setAssistantResponse(data.assistant_response);
        setUiState("idle"); // 反馈后回到审批状态
        // 用真实回答替换掉最后一条（转圈占位）
        setHistory(prev => [
          ...prev.slice(0, -1),
          { role: "assistant", content: data.assistant_response }
        ]);
        setFeedback("");
      } else {
        // 流式接口
        const resumePayload = {
          thread_id: threadId,
          review_action: "feedback",
          human_comment: feedback
        };
        recordDebugEvent(
          "request",
          "POST /graph/stream/resume · feedback",
          { method: "POST", url: "http://localhost:8000/graph/stream/resume", body: resumePayload },
          "前端提交审核反馈；后端把 status 和 human_comment 写回 checkpoint 后重新运行草稿节点。",
          "frontend/src/AssistantService.js"
        );
        const data = await AssistantService.resumeStreamingConversation(resumePayload, (response) => {
          recordDebugEvent("response", `POST /graph/stream/resume · HTTP ${response.status}`, response, "后端已接收反馈，run_status 为 pending。", "backend/app/lesson_02_streaming.py");
        });
        
        // 清空回答，准备逐 token 累加
        setAssistantResponse("");
        
        // 重置本轮累加用的 ref
        feedbackAccumulatedResponseRef.current = "";
        
        // 开始接收流式响应
        const eventSource = AssistantService.streamResponse(
          threadId,
          // 消息回调：处理收到的 token
          (data) => {
            if (data.content) {
              // 累加新内容到 ref
              feedbackAccumulatedResponseRef.current += data.content;
              
              // 更新 React 状态
              setAssistantResponse(feedbackAccumulatedResponseRef.current);
              
              // 用当前累加内容替换转圈占位条
              setHistory(prev => [
                ...prev.slice(0, -1),
                { role: "assistant", content: feedbackAccumulatedResponseRef.current }
              ]);
            } else if (data.status) {
              // 根据状态更新界面
              if (data.status === "user_feedback") {
                setUiState("idle"); // 展示审批按钮
              } else if (data.status === "plan_review") {
                setPlanSteps(data.plan_steps || []);
                setPlanFeedback("");
                setUiState("plan_review");
              } else if (data.status === "finished") {
                setUiState("finished");
              }
            }
          },
          // 错误回调
          (error) => {
            console.error("流式传输出错:", error);
            recordDebugEvent("error", "SSE 连接错误", { message: error?.message || String(error) }, null, "frontend/src/AssistantService.js");
            setUiState("idle");
            // 使用前先判断 error 是否有 message 属性
            const errorMessage = error && error.message ? error.message : "未知错误";
            alert("流式传输出错：" + errorMessage);
          },
          // 完成回调
          () => {
            console.log("流式传输结束");
            // 最终的记录更新已在消息回调里处理
          },
          recordTrace
        );
        
        setFeedback(""); // 清空反馈输入框
      }
    } catch (err) {
      recordDebugEvent("error", "反馈流程失败", { message: err.message }, null, "frontend/src/App.js");
      setUiState("idle");
      // 使用前先判断 err 是否有 message 属性
      const errorMessage = err && err.message ? err.message : "未知错误";
      alert("连接后端失败：" + errorMessage);
    }
  };

  // 可复用的按钮样式（扁平、彩色、圆角）
  const btnBase = { height: 46, padding: "0 26px", fontSize: 16, fontWeight: 600, borderRadius: 8, border: "none", cursor: "pointer" };
  const btnPrimary = { ...btnBase, background: "#1976d2", color: "#fff" };   // 发送
  const btnApprove = { ...btnBase, background: "#43a047", color: "#fff" };   // 批准
  const btnFeedback = { ...btnBase, background: "#fb8c00", color: "#fff" };  // 提供反馈
  const btnGhost = { ...btnBase, background: "#eceff1", color: "#37474f" };  // 次要/取消

  // 流程步骤条：根据当前状态推断处于第几步（对应左侧流程图 ①②③④）
  const steps = ["提问", "规划", "执行", "审查", "完成"];
  const hasAnswer = assistantResponse || (history.length > 0 && history[history.length - 1].role === "assistant" && history[history.length - 1].content);
  let activeStep = 0;                                   // 默认：提问
  if (uiState === "finished") activeStep = 4;
  else if (uiState === "user_feedback" || (uiState === "idle" && hasAnswer)) activeStep = 3;
  else if (uiState === "plan_review") activeStep = 1;
  else if (uiState === "waiting") activeStep = history.length > 2 ? 3 : planSteps.length ? 2 : 1;

  // 渲染界面
  return (
    <>
      <div className="view-switcher" role="tablist" aria-label="页面视图">
        <button
          className={activeView === "demo" ? "view-tab is-active" : "view-tab"}
          onClick={() => setActiveView("demo")}
          role="tab"
          aria-selected={activeView === "demo"}
        >
          对话演示
        </button>
        <button
          className={activeView === "guide" ? "view-tab is-active" : "view-tab"}
          onClick={() => setActiveView("guide")}
          role="tab"
          aria-selected={activeView === "guide"}
        >
          请求与 Agent 原理
        </button>
        <button
          className={activeView === "debug" ? "view-tab is-active" : "view-tab"}
          onClick={() => setActiveView("debug")}
          role="tab"
          aria-selected={activeView === "debug"}
        >
          LangGraph HITL · {debugEvents.length}
        </button>
      </div>
      {activeView === "guide" ? <FlowGuide /> : activeView === "debug" ? (
        <DebuggerPanel
          events={debugEvents}
          onClear={() => {
            setDebugEvents([]);
            debugSequenceRef.current = 0;
          }}
        />
      ) : (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', gap: 32, width: '94%', maxWidth: 1440, margin: '40px auto', padding: '0 16px', fontFamily: "-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif", color: '#263238' }}>
      {/* 左侧：流程示意图 */}
      <div style={{ flex: '0 0 380px', position: 'sticky', top: 40, background: '#fff', borderRadius: 14, border: '1px solid #eceff1', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', padding: 22, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <img src="/hitl-flow.svg" alt="人工介入（HITL）工作流示意图" style={{ width: '100%', height: 'auto' }} />
      </div>
      {/* 右侧：对话主区域 */}
      <div style={{ flex: 1, padding: 32, borderRadius: 14, border: '1px solid #eceff1', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', position: 'relative', background: '#fff' }}>
        {/* 顶部：标题 + 新建会话按钮 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 22 }}>人工介入助手</h2>
            <div style={{ fontSize: 13, color: '#78909c', marginTop: 4 }}>AI 先给草稿，你来批准或打回重写</div>
          </div>
          <button
            onClick={() => {
              setUiState("idle");
              setQuestion("");
              setAssistantResponse("");
              setFeedback("");
              setPlanSteps([]);
              setPlanFeedback("");
              setThreadId(null);
              setHistory([]);
            }}
            style={{ ...btnGhost, height: 38, padding: "0 16px", fontSize: 14 }}
          >
            新建会话
          </button>
        </div>

        {/* 步骤条 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '18px 0 22px' }}>
          {steps.map((label, i) => (
            <React.Fragment key={label}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20,
                fontSize: 13, fontWeight: 600,
                background: i <= activeStep ? '#e3f2fd' : '#f5f5f5',
                color: i <= activeStep ? '#1565c0' : '#b0bec5',
                border: i === activeStep ? '1px solid #1976d2' : '1px solid transparent'
              }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 18, height: 18, borderRadius: '50%', fontSize: 11,
                  background: i <= activeStep ? '#1976d2' : '#cfd8dc', color: '#fff'
                }}>{i + 1}</span>
                {label}
              </div>
              {i < steps.length - 1 && (
                <div style={{ flex: 1, height: 2, background: i < activeStep ? '#1976d2' : '#e0e0e0', borderRadius: 2 }} />
              )}
            </React.Fragment>
          ))}
        </div>
        {/* 初始输入框：仅在空闲且无对话记录时显示 */}
        {uiState === "idle" && history.length === 0 && (
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              type="text"
              placeholder="请输入你的问题…"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleStart(); }}
              style={{ flex: 1, padding: "0 14px", height: 46, fontSize: 16, borderRadius: 8, border: '1px solid #cfd8dc', outline: 'none' }}
            />
            <button onClick={handleStart} style={btnPrimary} disabled={!question.trim()}>发送</button>
          </div>
        )}

        {/* 对话记录区 */}
        {history.length > 0 && (
          <div style={{ margin: "8px 0 4px" }}>
            {history.map((msg, idx) => {
              // 已完成状态下，隐藏最后一条 AI 消息（它会在下方「最终版本」里展示）
              if (uiState === "finished" && msg.role === "assistant" && idx === history.length - 1) {
                return null;
              }
              const isUser = msg.role === "user";
              // 为每条消息计算上方的小提示文字
              let hint = null;
              if (isUser) {
                hint = idx === 0 ? "初始请求" : "反馈";
              } else if (idx === history.length - 1 && uiState === "finished") {
                hint = "你已批准";
              }
              return (
                <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', margin: "14px 0" }}>
                  <div style={{ fontSize: 12, color: "#90a4ae", marginBottom: 4 }}>
                    {isUser ? "你" : "助手"}{hint ? ` · ${hint}` : ""}
                  </div>
                  <div style={{
                    maxWidth: '85%', padding: '10px 14px', borderRadius: 12, fontSize: 15, lineHeight: 1.6,
                    background: isUser ? '#1976d2' : '#f4f6f8',
                    color: isUser ? '#fff' : '#263238',
                    borderTopRightRadius: isUser ? 2 : 12,
                    borderTopLeftRadius: isUser ? 12 : 2
                  }}>
                    {/* content 为 null 表示加载中，显示转圈动画 */}
                    {msg.role === "assistant" && msg.content === null ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, color: '#90a4ae' }}>
                        <div style={{
                          border: "3px solid #e0e0e0", borderTop: "3px solid #1976d2", borderRadius: "50%",
                          width: 18, height: 18, animation: "spin 1s linear infinite"
                        }} />
                        思考中…
                        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
                      </div>
                    ) : msg.role === "assistant" ? (
                      <div className="md-body"><ReactMarkdown>{msg.content}</ReactMarkdown></div>
                    ) : (
                      msg.content
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {uiState === "plan_review" && (
          <section className="plan-review-panel">
            <div className="plan-review-heading">
              <div>
                <span>HUMAN PLAN REVIEW</span>
                <h3>后端已生成执行计划</h3>
                <p>逐项修改后确认，Agent 才会开始执行。每一步的结果会单独记录。</p>
              </div>
              <span className="plan-review-count">{planSteps.length} / 7 步</span>
            </div>
            <div className="editable-plan-steps">
              {planSteps.map((step, index) => (
                <div className="editable-plan-step" key={step.id || index}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <textarea
                    value={step.description}
                    rows={2}
                    maxLength={500}
                    onChange={event => setPlanSteps(previous => previous.map((item, itemIndex) => (
                      itemIndex === index ? { ...item, description: event.target.value } : item
                    )))}
                    aria-label={`计划步骤 ${index + 1}`}
                  />
                  <button
                    type="button"
                    title="删除步骤"
                    aria-label={`删除步骤 ${index + 1}`}
                    disabled={planSteps.length <= 1}
                    onClick={() => setPlanSteps(previous => previous.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    −
                  </button>
                </div>
              ))}
            </div>
            <button
              className="plan-add-step"
              type="button"
              disabled={planSteps.length >= 7}
              onClick={() => setPlanSteps(previous => [
                ...previous,
                { id: `step_${Date.now()}`, description: "", status: "pending" }
              ])}
            >
              + 添加计划步骤
            </button>
            <label className="plan-feedback-label" htmlFor="plan-feedback">重新规划意见</label>
            <textarea
              id="plan-feedback"
              value={planFeedback}
              onChange={event => setPlanFeedback(event.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="需要模型重新规划时，写下原因或补充要求"
            />
            <div className="plan-review-actions">
              <button
                type="button"
                className="plan-confirm-button"
                disabled={planSteps.some(step => !step.description.trim())}
                onClick={() => handlePlanReview("approved")}
              >
                确认计划并执行
              </button>
              <button
                type="button"
                className="plan-replan-button"
                disabled={!planFeedback.trim()}
                onClick={() => handlePlanReview("replan")}
              >
                根据意见重新规划
              </button>
            </div>
          </section>
        )}
        {/* 反馈输入区：进入 user_feedback 状态时显示 */}
        {uiState === "user_feedback" && (
          <div style={{ marginTop: 20, background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 12, padding: 18 }}>
            <div style={{ marginBottom: 10, fontWeight: 600, color: '#e65100' }}>请填写反馈，帮助助手改进回答：</div>
            <textarea
              ref={feedbackInputRef}
              value={feedback}
              onChange={e => setFeedback(e.target.value)}
              rows={3}
              style={{ width: '100%', boxSizing: 'border-box', padding: 12, fontSize: 15, borderRadius: 8, border: '1px solid #ffcc80', resize: 'vertical', outline: 'none' }}
              placeholder="在此输入你的反馈…"
            />
            <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>
              <button onClick={handleFeedback} style={btnFeedback} disabled={!feedback.trim()}>提交反馈</button>
              <button
                onClick={() => { setUiState("idle"); setFeedback(""); }}
                style={btnGhost}
              >
                取消
              </button>
            </div>
          </div>
        )}
        {uiState === "waiting" && null}
        {/* 审批按钮区：空闲且已有 AI 回答时显示 */}
        {uiState === "idle" && hasAnswer && (
          <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button onClick={handleApprove} style={btnApprove}>批准</button>
            <button onClick={() => setUiState("user_feedback")} style={btnFeedback}>提供反馈</button>
          </div>
        )}
        {/* 已完成：展示最终定稿答案 */}
        {uiState === "finished" && (
          <div style={{ marginTop: 20, background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 12, padding: 18 }}>
            <div style={{ marginBottom: 8, fontWeight: 600, color: '#2e7d32' }}>✓ 最终版本</div>
            <div className="md-body"><ReactMarkdown>{assistantResponse}</ReactMarkdown></div>
          </div>
        )}
      </div>
    </div>
      )}
    </>
  );
};

export default App;
