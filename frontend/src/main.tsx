import React from "react";
import ReactDOM from "react-dom/client";
// IBM Plex —— 工程/工业气质的字体，Mono 做正文、Sans 做标题
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
// 公式(KaTeX) + 代码高亮(highlight.js) 的样式
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
