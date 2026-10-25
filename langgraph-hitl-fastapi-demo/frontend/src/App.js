import React, { useState, useRef, useEffect } from "react";
import AssistantService from "./AssistantService";
import ReactMarkdown from "react-markdown";

// 开关：true 用流式接口（SSE，逐字显示），false 用阻塞接口（一次返回完整结果）
const USE_STREAMING = true;

const App = () => {
  // 界面状态机，共四种：idle（空闲/展示审批按钮）、waiting（等待后端）、
  // user_feedback（填写反馈）、finished（已批准，展示最终答案）
  const [uiState, setUiState] = useState("idle");
  const [question, setQuestion] = useState("");            // 用户输入的问题
  const [assistantResponse, setAssistantResponse] = useState(""); // AI 当前回答
  const [feedback, setFeedback] = useState("");            // 用户填写的反馈
  const [threadId, setThreadId] = useState(null);          // 后端会话 ID，用于续接同一轮对话
  const [history, setHistory] = useState([]);              // 对话记录数组 [{role, content}]

  // useRef 存流式累加的文本：直接改 .current 不会触发重渲染，适合在回调里累加 token
  const startAccumulatedResponseRef = useRef("");
  const approveAccumulatedResponseRef = useRef("");
  const feedbackAccumulatedResponseRef = useRef("");

  // 反馈输入框的引用，用于自动聚焦
  const feedbackInputRef = useRef(null);
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
        setAssistantResponse(data.assistant_response);
        setUiState("idle"); // 回到 idle，以便先展示审批按钮
        setThreadId(data.thread_id);
        setHistory([
          { role: "user", content: question },
          { role: "assistant", content: data.assistant_response }
        ]);
      } else {
        // 流式接口：先建会话拿到 thread_id，再用 SSE 逐字接收
        const data = await AssistantService.createStreamingConversation(question);
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
              if (data.status === "user_feedback") {
                setUiState("idle"); // 展示审批按钮
              } else if (data.status === "finished") {
                setUiState("finished");
              }
            }
          },
          // 错误回调
          (error) => {
            console.error("流式传输出错:", error);
            setUiState("idle");
            // 使用前先判断 error 是否有 message 属性
            const errorMessage = error && error.message ? error.message : "未知错误";
            alert("流式传输出错：" + errorMessage);
          },
          // 完成回调
          () => {
            console.log("流式传输结束");
            // 最终的记录更新已在消息回调里处理
          }
        );
      }
    } catch (err) {
      setAssistantResponse("");
      setUiState("idle");
      // 使用前先判断 err 是否有 message 属性
      const errorMessage = err && err.message ? err.message : "未知错误";
      alert("连接后端失败：" + errorMessage);
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
        const data = await AssistantService.resumeStreamingConversation({
          thread_id: threadId,
          review_action: "approved"
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
              if (data.status === "finished") {
                setUiState("finished");
              }
            }
          },
          // 错误回调
          (error) => {
            console.error("流式传输出错:", error);
            setUiState("idle");
            // 使用前先判断 error 是否有 message 属性
            const errorMessage = error && error.message ? error.message : "未知错误";
            alert("流式传输出错：" + errorMessage);
          },
          // 完成回调
          () => {
            console.log("流式传输结束");
            // 最终的记录更新已在消息回调里处理
          }
        );
      }
    } catch (err) {
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
        const data = await AssistantService.resumeStreamingConversation({
          thread_id: threadId,
          review_action: "feedback",
          human_comment: feedback
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
              } else if (data.status === "finished") {
                setUiState("finished");
              }
            }
          },
          // 错误回调
          (error) => {
            console.error("流式传输出错:", error);
            setUiState("idle");
            // 使用前先判断 error 是否有 message 属性
            const errorMessage = error && error.message ? error.message : "未知错误";
            alert("流式传输出错：" + errorMessage);
          },
          // 完成回调
          () => {
            console.log("流式传输结束");
            // 最终的记录更新已在消息回调里处理
          }
        );
        
        setFeedback(""); // 清空反馈输入框
      }
    } catch (err) {
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
  const steps = ["提问", "生成", "审查", "完成"];
  const hasAnswer = assistantResponse || (history.length > 0 && history[history.length - 1].role === "assistant" && history[history.length - 1].content);
  let activeStep = 0;                                   // 默认：提问
  if (uiState === "finished") activeStep = 3;           // 完成
  else if (uiState === "user_feedback" || (uiState === "idle" && hasAnswer)) activeStep = 2; // 审查
  else if (uiState === "waiting") activeStep = 1;       // 生成中

  // 渲染界面
  return (
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
            <button onClick={handleStart} style={btnPrimary}>发送</button>
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
              <button onClick={handleFeedback} style={btnFeedback}>提交反馈</button>
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
  );
};

export default App;
