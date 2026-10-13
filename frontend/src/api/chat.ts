// 封装调后端 /api/chat 的 SSE 流式请求。
// 后端用的是 POST + text/event-stream，浏览器原生 EventSource 只支持 GET，
// 所以这里用 fetch + 手动读 ReadableStream 来接收逐字输出。

// 默认走相对路径（空 base），即请求同源的 /api/chat，由 Vite dev 代理转发到后端，
// 从根本上避免跨域。需要直连别的后端时再用 VITE_API_BASE 覆盖。
const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export async function askChat(
  question: string,
  onDelta: (text: string) => void,
  opts?: { onSources?: (sources: string[]) => void; signal?: AbortSignal }
): Promise<void> {
  const resp = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
    signal: opts?.signal,
  });

  if (!resp.ok || !resp.body) {
    throw new Error(`请求失败：${resp.status}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    // SSE 事件之间用 \n\n 分隔；跨 chunk 的半条数据先缓存在 buffer 里。
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const evt of events) {
      const line = evt.trimStart();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      // 后端在流中途出错时发错误事件（[ERROR] 前缀），抛出去让上层提示
      if (payload.startsWith("[ERROR]")) {
        throw new Error(payload.slice(7).trim() || "生成回答时出错");
      }
      // 出处事件（[SOURCES] 前缀）：命中的资料片段列表
      if (payload.startsWith("[SOURCES]")) {
        try {
          opts?.onSources?.(JSON.parse(payload.slice(9).trim()) as string[]);
        } catch {
          /* 出处解析失败不影响正文 */
        }
        continue;
      }
      // 后端把每个片段 JSON 编码过（保留换行等），这里解回原文
      try {
        onDelta(JSON.parse(payload) as string);
      } catch {
        onDelta(payload);
      }
    }
  }
}
