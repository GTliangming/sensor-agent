import type { RouteObject } from 'react-router-dom'
import { EnginePage } from './pages/EnginePage'
import { TaskDetailPage } from './pages/TaskDetailPage'
import { ENGINE_BASE } from './paths'

/** 引擎的路由。生产流程用它生成视频，这里额外提供“手动生成/调试”入口。 */
export const routes: RouteObject[] = [
  {
    path: ENGINE_BASE.slice(1),
    children: [
      { index: true, element: <EnginePage /> },
      { path: 'tasks/:taskId', element: <TaskDetailPage /> },
    ],
  },
]
