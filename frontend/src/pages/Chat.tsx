import { useEffect, useRef, useState } from "react";
import { askChat } from "../api/chat";
import MarkdownView from "../components/MarkdownView";

type Msg = { role: "user" | "assistant"; content: string; sources?: string[] };

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

export default function Chat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function resize() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }

  async function handleSend() {
    const q = input.trim();
    if (!q || loading) return;

    setInput("");
    setError("");
    setMessages((m) => [
      ...m,
      { role: "user", content: q },
      { role: "assistant", content: "" },
    ]);
    setLoading(true);
    requestAnimationFrame(resize);

    try {
      await askChat(
        q,
        (delta) => {
          setMessages((m) => {
            const copy = m.slice();
            const last = copy[copy.length - 1];
            copy[copy.length - 1] = { ...last, content: last.content + delta };
            return copy;
          });
        },
        {
          onSources: (sources) => {
            setMessages((m) => {
              const copy = m.slice();
              const last = copy[copy.length - 1];
              copy[copy.length - 1] = { ...last, sources };
              return copy;
            });
          },
        }
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "请求出错");
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const empty = messages.length === 0;

  return (
    <>
      <div className="chat-scroll">
        {empty ? (
          <div className="chat-empty">
            <h1>有什么可以帮你的？</h1>
            <p>&gt; RAG PIPELINE READY · 基于已入库的传感器 / 示波器文档作答</p>
          </div>
        ) : (
          <div className="messages">
            {messages.map((m, i) => {
              const streaming =
                loading && i === messages.length - 1 && m.role === "assistant";
              return (
                <div key={i} className={`msg msg-${m.role}`}>
                  <div className="msg-inner">
                    <div className={`avatar avatar-${m.role}`}>
                      {m.role === "user" ? "你" : "AI"}
                    </div>
                    <div className="msg-body">
                      <div className="msg-role">
                        {m.role === "user" ? "USER" : "ASSISTANT"}
                      </div>
                      <div className="bubble">
                        {m.role === "assistant" ? (
                          <MarkdownView content={m.content} />
                        ) : (
                          m.content
                        )}
                        {streaming && <span className="cursor" />}
                      </div>
                      {m.role === "assistant" &&
                        m.sources &&
                        m.sources.length > 0 && (
                          <div className="sources">
                            <div className="sources-label">引用来源</div>
                            <div className="sources-list">
                              {m.sources.map((s) => (
                                <span className="source-chip" key={s} title={s}>
                                  {s}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {error && <div className="chat-error">⚠️ {error}</div>}

      <div className="composer-wrap">
        <div className="composer">
          <textarea
            ref={taRef}
            value={input}
            rows={1}
            onChange={(e) => {
              setInput(e.target.value);
              resize();
            }}
            onKeyDown={onKeyDown}
            placeholder="给 Sensor-Agent 发送消息"
            disabled={loading}
          />
          <button
            className="send-btn"
            onClick={handleSend}
            disabled={loading || !input.trim()}
            aria-label="发送"
          >
            <SendIcon />
          </button>
        </div>
        <div className="composer-hint">Enter 发送，Shift + Enter 换行</div>
      </div>
    </>
  );
}
