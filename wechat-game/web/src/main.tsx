import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

/**
 * 渲染兜底：任何未捕获的渲染错误都显示可重试的界面，而不是白屏。
 * 渲染错误无法靠 try/catch 兜住，ErrorBoundary 是唯一入口。
 */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="stage stage--menu">
        <div className="menu">
          <h1 className="menu__title">出了点问题</h1>
          <p className="menu__desc">游戏遇到错误打不开了，重新加载一般就能恢复。{error.message}</p>
          <button className="btn btn--primary" onClick={() => location.reload()}>
            重新加载
          </button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
