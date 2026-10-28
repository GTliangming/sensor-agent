import type { RouteObject } from 'react-router-dom'
import { ENGINE_BASE } from './autodl-comfyui-i2v/paths'
import { routes as comfyuiRoutes } from './autodl-comfyui-i2v/routes'

export interface EngineEntry {
  id: string
  label: string
  path: string
  routes: RouteObject[]
}

/**
 * 生成引擎注册表。新增引擎（如自建 ComfyUI）：
 * 1. 在 engines/ 下新建目录，导出自己的 routes；
 * 2. 在这里加一项 —— 侧边栏入口和路由会自动出现。
 */
export const ENGINES: EngineEntry[] = [
  {
    id: 'autodl-comfyui-i2v',
    label: 'AutoDL · ComfyUI 图生视频',
    path: ENGINE_BASE,
    routes: comfyuiRoutes,
  },
]
