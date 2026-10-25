import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// 应用入口：把 <App /> 挂载到 public/index.html 里的 <div id="root">
const container = document.getElementById("root");
const root = createRoot(container);
root.render(<App />);
