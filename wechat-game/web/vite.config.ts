import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // three.js 和 React 单独成包：游戏代码更新时用户不必重新下载这两个大依赖
        manualChunks: { three: ["three"], react: ["react", "react-dom"] },
      },
    },
    // three.js 本身约 600KB（gzip 约 150KB），单包超过默认 500KB 提示阈值属正常
    chunkSizeWarningLimit: 700,
  },
});
