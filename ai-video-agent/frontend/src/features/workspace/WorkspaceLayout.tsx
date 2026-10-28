import { Navigate, NavLink, Outlet } from 'react-router-dom'
import { EmptyState, ErrorState, LoadingRows } from '@/shared/components/StateViews'
import { useBusinessLines, useWorkspace, workspacePath } from './hooks'

const TABS = [
  { to: 'create', label: '创建' },
  { to: 'manual', label: '手动创建' },
  { to: 'tasks', label: '任务列表' },
  { to: 'templates', label: '提示词模板' },
  { to: 'settings', label: '账号设置' },
]

/** 工作区：一个账号类型下的全部操作，标签页决定做什么。 */
export function WorkspaceLayout() {
  const { account, line, isLoading, error, refetch } = useWorkspace()
  if (isLoading) return <LoadingRows rows={3} />
  if (error) return <ErrorState message={error.message} onRetry={() => refetch()} />
  if (!account || !line) return <EmptyState title="没有找到这个账号类型" hint="它可能已被停用，请从顶部重新选择。" />

  return (
    <div className="workspace">
      <div className="workspace-head">
        <h1>{account.name}</h1>
        <p className="muted">{line.name}</p>
      </div>
      <nav aria-label="工作区" className="tabs">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>{t.label}</NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  )
}

/** 根路径：直接进入第一个账号类型的任务列表。 */
export function HomeRedirect() {
  const { data, isLoading, error, refetch } = useBusinessLines()
  if (isLoading) return <LoadingRows rows={3} />
  if (error) return <ErrorState message={error.message} onRetry={() => refetch()} />
  const line = data?.find((l) => l.account_types.length > 0)
  if (!line) return <EmptyState title="还没有业务线" hint="请先在后端写入出厂数据（启动服务时会自动写入）。" />
  return <Navigate to={workspacePath(line.key, line.account_types[0].id)} replace />
}
