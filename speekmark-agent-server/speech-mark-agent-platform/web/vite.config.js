// vite.config.js：Vite 构建工具的配置文件（类比 Python 项目里的 setup.cfg / pyproject.toml）
// 作用：声明构建插件以及本地开发服务器的行为

import { defineConfig } from 'vite';
// 让 Vite 支持 React（JSX 语法、热更新等）的官方插件
import react from '@vitejs/plugin-react';

// defineConfig 只是个辅助函数，提供类型提示，包裹配置对象即可
export default defineConfig({
  // 启用的插件列表，这里只加载 React 插件
  plugins: [react()],
  // server：仅在本地开发（npm run dev）时生效的开发服务器设置
  server: {
    // host 设为 0.0.0.0 表示监听所有网卡，局域网内其他设备也能访问
    host: '0.0.0.0',
    // 开发服务器监听的端口号
    port: 5173,
    // proxy：开发期的请求代理，用来把前端请求转发给后端，规避跨域问题
    proxy: {
      // 凡是以 /api 开头的请求都走下面的代理规则
      '/api': {
        // 实际转发到的后端地址
        target: 'http://localhost:8080',
        // 转发时把请求头里的 Host 改成目标地址，后端才会正确处理
        changeOrigin: true,
        // 重写路径：把开头的 /api 替换成 /api/v1，再发给后端
        rewrite: (path) => path.replace(/^\/api/, '/api/v1'),
      },
    },
  },
});
