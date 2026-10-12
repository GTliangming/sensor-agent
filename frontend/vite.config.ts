import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 开发端口 5173。/api 的请求由 Vite 代理转发到后端 Flask(5000)，
// 这样浏览器只跟同源(5173)通信，彻底规避 CORS。
export default defineConfig({
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
});
