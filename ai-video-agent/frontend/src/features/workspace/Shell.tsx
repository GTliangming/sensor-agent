import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom'
import { ENGINES } from '@/engines'
import { useBusinessLines, workspacePath } from './hooks'

/**
 * 应用外壳：顶部栏。业务线和账号类型是两级切换，切换时保持在同一个标签页。
 * 生成引擎的手动入口放在右侧，新增引擎会自动出现。
 */
export function Shell() {
  // Shell 是父路由，拿不到子路由的参数，所以用 useMatch 从 URL 里取
  const match = useMatch('/:lineKey/:accountId/*')
  const lineKey = match?.params.lineKey
  const accountId = match?.params.accountId
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { data: lines } = useBusinessLines()
  const line = lines?.find((l) => l.key === lineKey)
  const tab = pathname.split('/')[3] ?? 'tasks'
  const inWorkspace = !!line

  function switchTo(nextLine: string, nextAccount: string) {
    navigate(workspacePath(nextLine, nextAccount, ['create', 'tasks', 'templates', 'settings'].includes(tab) ? tab : 'tasks'))
  }

  const cls = ({ isActive }: { isActive: boolean }) => (isActive ? 'nav-link active' : 'nav-link')

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">AI Video Studio</Link>
        {lines && lines.length > 0 && (
          <div className="switchers">
            <label className="switcher">
              <span className="visually-hidden">业务线</span>
              <select value={inWorkspace ? lineKey : ''} onChange={(e) => {
                const next = lines.find((l) => l.key === e.target.value)
                if (next?.account_types[0]) switchTo(next.key, next.account_types[0].id)
              }}>
                {!inWorkspace && <option value="">选择业务线</option>}
                {lines.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}
              </select>
            </label>
            <label className="switcher">
              <span className="visually-hidden">账号类型</span>
              <select value={inWorkspace ? accountId : ''} disabled={!inWorkspace}
                onChange={(e) => line && switchTo(line.key, e.target.value)}>
                {!inWorkspace && <option value="">选择账号类型</option>}
                {line?.account_types.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          </div>
        )}
        <nav aria-label="生成引擎" className="topnav">
          {ENGINES.map((e) => <NavLink key={e.id} to={e.path} className={cls}>手动生成</NavLink>)}
        </nav>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </div>
  )
}
