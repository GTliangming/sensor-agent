import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { EmptyState, ErrorState, LoadingRows } from '@/shared/components/StateViews'
import { formatTime } from '@/shared/format'
import { useWorkspace } from '@/features/workspace/hooks'
import { ProgressInfo, StatusBadge, StepBar } from '../components/StatusParts'
import { useProductionList } from '../hooks'
import { FILTERS, isReviewStatus, matchesFilter, RUN_MODE_LABEL, type FilterKey } from '../status'

/** 任务列表：这个账号类型下的全部生产任务。筛选放在 URL 里，刷新和分享都保持不变。 */
export function TasksTab() {
  const { accountId } = useWorkspace()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const filter = (FILTERS.find((f) => f.key === params.get('filter'))?.key ?? 'all') as FilterKey
  const { data, isLoading, error, refetch } = useProductionList(accountId)

  const items = data?.items.filter((p) => matchesFilter(p, filter)) ?? []
  const reviewCount = data?.items.filter((p) => isReviewStatus(p.status)).length ?? 0
  const runningCount = data?.items.filter((p) => matchesFilter(p, 'running')).length ?? 0
  const doneCount = data?.items.filter((p) => matchesFilter(p, 'done')).length ?? 0

  return (
    <section className="stack" aria-labelledby="tasks-title">
      <div className="row-between">
        <h2 id="tasks-title">任务列表</h2>
        <div className="filters" role="group" aria-label="筛选">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" className={f.key === filter ? 'chip active' : 'chip'}
              aria-pressed={f.key === filter}
              onClick={() => setParams(f.key === 'all' ? {} : { filter: f.key }, { replace: true })}>
              {f.label}{f.key === 'review' && reviewCount > 0 && <span className="num"> {reviewCount}</span>}
            </button>
          ))}
        </div>
      </div>

      {data && data.items.length > 0 && (
        <dl className="figures" aria-label="任务概况">
          <div className={reviewCount > 0 ? 'figure-cell figure-lead' : 'figure-cell'}>
            <dt>待审核</dt><dd className="num">{reviewCount}</dd>
          </div>
          <div className="figure-cell"><dt>进行中</dt><dd className="num">{runningCount}</dd></div>
          <div className="figure-cell"><dt>已完成</dt><dd className="num">{doneCount}</dd></div>
          <div className="figure-cell"><dt>全部任务</dt><dd className="num">{data.items.length}</dd></div>
        </dl>
      )}

      {isLoading && <LoadingRows />}
      {error && <ErrorState message={error.message} onRetry={() => refetch()} />}
      {data && items.length === 0 && (
        <EmptyState
          title={filter === 'all' ? '还没有任务' : '没有符合条件的任务'}
          hint={filter === 'all' ? '先去创建第一条视频。' : '换一个筛选条件看看。'}
          action={filter === 'all' ? <button type="button" className="btn btn-primary" onClick={() => navigate('../create')}>去创建</button> : undefined}
        />
      )}
      {items.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">主题</th>
                <th scope="col">状态</th>
                <th scope="col">进度</th>
                <th scope="col">规格</th>
                <th scope="col">创建时间</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td className="cell-topic">
                    <Link to={p.id}>{p.topic || '主题由 AI 生成中'}</Link>
                    <span className="muted">{RUN_MODE_LABEL[p.run_mode]}</span>
                  </td>
                  <td><StatusBadge status={p.status} /></td>
                  <td className="cell-progress">
                    <StepBar status={p.status} compact />
                    <ProgressInfo production={p} />
                  </td>
                  <td className="num">{p.resolution}<br />{p.duration_seconds} 秒</td>
                  <td className="num">{formatTime(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
