// AssistantService.js
// 统一封装与后端会话/对话相关的所有 API 调用（类似后端的一个 service 层）

// 后端地址，开发时后端跑在本机 8000 端口
const BASE_URL = "http://localhost:8000";

export default class AssistantService {
  // ===== 阻塞式接口（一次请求，等完整结果返回）=====

  // 发起一轮新对话
  static async startConversation(human_request) {
    const response = await fetch(`${BASE_URL}/graph/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ human_request })
    });
    if (!response.ok) throw new Error("网络请求失败");
    return response.json();
  }

  // 提交审批结果：批准（approved）或反馈（feedback，带 human_comment）
  static async submitReview({ thread_id, review_action, human_comment }) {
    const body = { thread_id, review_action };
    if (human_comment) body.human_comment = human_comment;
    const response = await fetch(`${BASE_URL}/graph/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error("网络请求失败");
    return response.json();
  }

  // ===== 流式接口（SSE，逐 token 返回）=====

  // 创建流式会话，返回 thread_id（后续用它连 SSE 流）
  static async createStreamingConversation(human_request, onResponse) {
    const response = await fetch(`${BASE_URL}/graph/stream/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ human_request })
    });
    const data = await response.json();
    onResponse?.({ status: response.status, statusText: response.statusText, body: data });
    if (!response.ok) throw new Error("网络请求失败");
    return data;
  }

  // 流式地续接会话：提交批准或反馈
  static async resumeStreamingConversation({ thread_id, review_action, human_comment }, onResponse) {
    const body = { thread_id, review_action };
    if (human_comment) body.human_comment = human_comment;
    const response = await fetch(`${BASE_URL}/graph/stream/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    onResponse?.({ status: response.status, statusText: response.statusText, body: data });
    if (!response.ok) throw new Error("网络请求失败");
    return data;
  }

  // Submit the planning checkpoint decision separately from answer review.
  static async submitPlanReview({ thread_id, plan_action, plan_steps, plan_feedback }, onResponse) {
    const response = await fetch(`${BASE_URL}/graph/stream/plan-review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thread_id, plan_action, plan_steps, plan_feedback })
    });
    const data = await response.json();
    onResponse?.({ status: response.status, statusText: response.statusText, body: data });
    if (!response.ok) {
      throw new Error(data.detail || "计划审核请求失败");
    }
    return data;
  }

  static async submitPlanReviewBlocking(payload) {
    const response = await fetch(`${BASE_URL}/graph/plan-review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "计划审核请求失败");
    return data;
  }

  // 建立 SSE 连接，持续接收服务端推送的事件
  // 三个回调：onMessageCallback（收到内容/状态）、onErrorCallback（出错）、onCompleteCallback（结束）
  static streamResponse(thread_id, onMessageCallback, onErrorCallback, onCompleteCallback, onTraceCallback) {
    // 用 EventSource 连到后端的流式端点
    const eventSource = new EventSource(`${BASE_URL}/graph/stream/${thread_id}`);
    if (onTraceCallback) {
      onTraceCallback({
        type: "connection",
        method: "GET",
        url: eventSource.url,
        thread_id
      });
    }

    eventSource.addEventListener("trace", (event) => {
      try {
        onTraceCallback?.({
          type: "backend",
          event: "trace",
          data: JSON.parse(event.data)
        });
      } catch (error) {
        onTraceCallback?.({
          type: "parse_error",
          event: "trace",
          raw: event.data,
          message: error.message
        });
      }
    });

    // token 事件：一段文字内容
    eventSource.addEventListener('token', (event) => {
      try {
        const data = JSON.parse(event.data);
        onTraceCallback?.({ type: "sse", event: "token", data });
        onMessageCallback({ content: data.content });
      } catch (error) {
        console.error("解析 token 事件出错:", error, "原始数据:", event.data);
        onErrorCallback(error);
      }
    });

    // status 事件：状态变更（user_feedback 需要人工审批 / finished 已结束）
    eventSource.addEventListener('status', (event) => {
      try {
        const data = JSON.parse(event.data);
        onTraceCallback?.({ type: "sse", event: "status", data });
        onMessageCallback({ status: data.status, plan_steps: data.plan_steps });

        // 标记本连接已收到过 status 事件
        // 用于区分「正常结束」和「真·报错」（SSE 正常关闭时浏览器也会触发 onerror）
        if (!window._hasReceivedStatusEvent) {
          window._hasReceivedStatusEvent = {};
        }
        window._hasReceivedStatusEvent[eventSource.url] = true;
        console.log("已收到 status 事件，标记该连接可正常关闭");
      } catch (error) {
        console.error("解析 status 事件出错:", error, "原始数据:", event.data);
        onErrorCallback(error);
      }
    });

    // start / resume 事件：仅打日志
    eventSource.addEventListener('start', (event) => {
      onTraceCallback?.({ type: "sse", event: "start", data: event.data });
      console.log("流已开始:", event.data);
    });

    eventSource.addEventListener('resume', (event) => {
      onTraceCallback?.({ type: "sse", event: "resume", data: event.data });
      console.log("流已续接:", event.data);
    });

    // 错误处理
    eventSource.onerror = (error) => {
      console.log("SSE 连接状态变化 - readyState:", eventSource.readyState);

      // 若之前已收到 status 事件，说明是正常结束而非报错
      const hasReceivedStatusEvent = window._hasReceivedStatusEvent && window._hasReceivedStatusEvent[eventSource.url];

      if (hasReceivedStatusEvent) {
        console.log("收到 status 事件后流正常结束");
        eventSource.close();
        onCompleteCallback();
        return;
      }

      // 只有在真正出错时才回调 onError，正常关闭则不算错误
      if (eventSource.readyState !== EventSource.CLOSED && eventSource.readyState !== EventSource.CONNECTING) {
        console.error("SSE 连接错误:", error);
        eventSource.close();
        // 包装成带 message 的 Error 对象，避免出现 'undefined'
        onErrorCallback(new Error("连接错误或服务端已断开"));
      } else {
        // 正常关闭或重连中，走完成回调
        console.log("流正常结束");
        onCompleteCallback();
      }
    };

    // 返回 eventSource，便于外部需要时主动关闭
    return eventSource;
  }
}
