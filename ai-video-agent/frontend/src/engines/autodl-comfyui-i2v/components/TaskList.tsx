import { Link } from 'react-router-dom'
import { EmptyState, ErrorState, LoadingRows } from '@/shared/components/StateViews'
import { formatTime } from '@/shared/format'
import { useTaskList } from '../hooks'
import { taskPath } from '../paths'
import { StatusBadge } from './StatusBadge'

export function TaskList() {
  const { data, isLoading, error, refetch } = useTaskList()

  return (
    <section className="stack" aria-labelledby="manual-tasks">
      <h2 id="manual-tasks">手动任务</h2>
      {isLoading && <LoadingRows rows={3} />}
      {error && <ErrorState message={error.message} onRetry={() => refetch()} />}
      {data && data.items.length === 0 && <EmptyState title="还没有手动任务" hint="在左侧填写提示词后确认生成。" />}
      {data && data.items.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th scope="col">提示词</th><th scope="col">状态</th><th scope="col">规格</th><th scope="col">创建时间</th></tr>
            </thead>
            <tbody>
              {data.items.map((t) => (
                <tr key={t.task_id}>
                  <td className="cell-topic">
                    <Link to={taskPath(t.task_id)}>{t.prompt_preview}</Link>
                    {t.queue_position && <span className="muted">排队第 {t.queue_position} 位</span>}
                    {t.expected_start_at && <span className="muted">预计 {formatTime(t.expected_start_at)} 开始</span>}
                    {t.error_message && <span className="field-error">{t.error_message}</span>}
                  </td>
                  <td><StatusBadge status={t.status} /></td>
                  <td className="num">{t.resolution}<br />{t.duration_seconds} 秒</td>
                  <td className="num">{formatTime(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
