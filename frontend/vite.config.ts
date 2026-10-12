import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: 部署到 GitHub Pages 项目站点时站点在 /sensor-agent/ 子路径下，
//       所以生产构建的静态资源路径要加这个前缀；本地 dev 用根路径。
// 开发端口 5173。/api 的请求由 Vite 代理转发到后端 Flask(5000)，规避 CORS（仅 dev 生效）。
export default defineConfig(({ mode }) => ({
  base: mode === "production" ? "/sensor-agent/" : "/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5000",
        changeOrigin: true,
      },
    },
  },
}));
