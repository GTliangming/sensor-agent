import { createBrowserRouter, Navigate } from 'react-router-dom'
import { ENGINES } from '@/engines'
import { CreateTab } from '@/features/productions/pages/CreateTab'
import { ManualCreateTab } from '@/features/productions/pages/ManualCreateTab'
import { ProductionDetailPage } from '@/features/productions/pages/ProductionDetailPage'
import { TasksTab } from '@/features/productions/pages/TasksTab'
import { SettingsTab } from '@/features/settings/SettingsTab'
import { TemplatesTab } from '@/features/templates/TemplatesTab'
import { Shell } from '@/features/workspace/Shell'
import { HomeRedirect, WorkspaceLayout } from '@/features/workspace/WorkspaceLayout'
import { NotFoundPage } from '@/shared/pages/NotFoundPage'

/**
 * 路由结构：/:业务线/:账号类型/:标签页。
 * 状态都在 URL 里（业务线、账号类型、标签页、筛选），刷新和分享链接都保持不变。
 * 生成引擎的路由由 engines 注册表提供，新增引擎不需要改这个文件。
 */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <HomeRedirect /> },
      ...ENGINES.flatMap((e) => e.routes),
      {
        path: ':lineKey/:accountId',
        element: <WorkspaceLayout />,
        children: [
          { index: true, element: <Navigate to="tasks" replace /> },
          { path: 'create', element: <CreateTab /> },
          { path: 'manual', element: <ManualCreateTab /> },
          { path: 'tasks', element: <TasksTab /> },
          { path: 'tasks/:productionId', element: <ProductionDetailPage /> },
          { path: 'templates', element: <TemplatesTab /> },
          { path: 'settings', element: <SettingsTab /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
