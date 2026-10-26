import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 开发期把 /internal、/healthz、/readyz 代理到本地后端，避免跨域、与生产同源
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/internal": { target: "http://127.0.0.1:8099", changeOrigin: true },
      "/healthz": { target: "http://127.0.0.1:8099", changeOrigin: true },
      "/readyz": { target: "http://127.0.0.1:8099", changeOrigin: true },
    },
  },
});
