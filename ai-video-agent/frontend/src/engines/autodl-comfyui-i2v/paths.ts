/** 引擎的路由前缀。生产流程不依赖引擎，引擎页面是“手动生成/调试”入口。 */
export const ENGINE_BASE = '/engines/autodl-comfyui-i2v'
export const taskPath = (taskId: string) => `${ENGINE_BASE}/tasks/${taskId}`
