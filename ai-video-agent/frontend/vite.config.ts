import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// 开发时把 /api 代理到后端，浏览器看到的是同源请求，不需要处理跨域。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backend = env.VITE_DEV_PROXY_TARGET || 'http://127.0.0.1:8000'
  return {
    plugins: [react()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5173,
      proxy: { '/api': { target: backend, changeOrigin: true } },
    },
  }
})
