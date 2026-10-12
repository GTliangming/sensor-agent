import { HashRouter, Routes, Route, NavLink } from "react-router-dom";
import Chat from "./pages/Chat";
import Documents from "./pages/Documents";

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  "nav-item" + (isActive ? " active" : "");

export default function App() {
  return (
    <HashRouter>
      <div className="app">
        <aside className="sidebar">
          <div className="sidebar-brand">Sensor-Agent</div>
          <nav className="sidebar-nav">
            <NavLink to="/" end className={navClass}>
              <ChatIcon />
              <span>提问</span>
            </NavLink>
            <NavLink to="/documents" className={navClass}>
              <DocIcon />
              <span>文档管理</span>
            </NavLink>
          </nav>
          <div className="sidebar-footer">工业传感器 / 示波器 · RAG 助手</div>
        </aside>
        <main className="main">
          <header className="topbar">
            <span className="topbar-title">SENSOR-AGENT // RAG CONSOLE</span>
            <div className="topbar-stats">
              <span className="stat">
                <span className="stat-dot" />
                ONLINE
              </span>
              <span className="stat">
                MODEL:&nbsp;<b>deepseek-flash</b>
              </span>
              <span className="stat">
                EMBED:&nbsp;<b>bge-m3</b>
              </span>
            </div>
          </header>
          <Routes>
            <Route path="/" element={<Chat />} />
            <Route path="/documents" element={<Documents />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
