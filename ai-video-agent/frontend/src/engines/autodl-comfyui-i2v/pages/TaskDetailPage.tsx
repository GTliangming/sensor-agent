import { Link, useParams } from 'react-router-dom'
import { ErrorState, LoadingRows } from '@/shared/components/StateViews'
import { VideoPlayer } from '@/shared/components/VideoPlayer'
import { formatTime } from '@/shared/format'
import { StatusBadge } from '../components/StatusBadge'
import { useCancelTask, useRetryTask, useTask } from '../hooks'
import { ENGINE_BASE } from '../paths'
import { isActive } from '../status'

export function TaskDetailPage() {
  const { taskId = '' } = useParams()
  const { data: task, isLoading, error, refetch } = useTask(taskId)
  const retry = useRetryTask()
  const cancel = useCancelTask()

  if (isLoading) return <LoadingRows rows={4} />
  if (error || !task) return <ErrorState message={error?.message ?? '任务不存在'} onRetry={() => refetch()} />

  function handleRetry() {
    // 提交结果不确定时外部任务可能仍在运行，重试会重复计费，需要用户确认
    const uncertain = task!.error_code === 'SUBMIT_UNCERTAIN'
    if (uncertain && !window.confirm('上次提交结果不确定，外部任务可能仍在运行。继续重试可能产生重复费用，确定吗？')) return
    retry.mutate({ taskId, arg: uncertain })
  }

  function handleCancel() {
    if (window.confirm('取消后系统将不再跟踪该任务；已提交到 GPU 的任务可能仍会继续运行。确定取消吗？')) {
      cancel.mutate({ taskId, arg: undefined })
    }
  }

  const actionError = retry.error ?? cancel.error

  return (
    <div className="stack">
      <Link to={ENGINE_BASE} className="btn-link">返回手动生成</Link>
      <section className="panel stack">
        <div className="row-between">
          <h1 className="detail-title">任务详情</h1>
          <StatusBadge status={task.status} />
        </div>

        {task.status === 'succeeded' && task.video_url && (
          <div className="player-wrap">
            <VideoPlayer src={task.video_url} aspectRatio={task.aspect_ratio} />
            <a className="btn-link" href={task.video_url} download={`${task.task_id}.mp4`}>下载视频</a>
          </div>
        )}

        {isActive(task.status) && (
          <p className="muted">
            {task.expected_start_at
              ? `正在等待夜间时段，预计 ${formatTime(task.expected_start_at)} 开始提交；提交后自动轮询结果，可以先离开。`
              : task.queue_position
                ? `排队第 ${task.queue_position} 位（同时最多运行 3 个），轮到后自动开始，可以先离开。`
                : '视频生成通常需要几分钟，页面会自动刷新状态，可以先离开。'}
          </p>
        )}

        {task.status === 'failed' && (
          <div className="state-box state-error" role="alert">
            <h3>生成失败</h3>
            <p>{task.error_message ?? '未知错误'}</p>
            <p className="muted">错误码 {task.error_code}</p>
          </div>
        )}

        <div className="actions">
          {task.can_retry && <button type="button" className="btn btn-primary" onClick={handleRetry} disabled={retry.isPending}>重试</button>}
          {isActive(task.status) && <button type="button" className="btn btn-danger" onClick={handleCancel} disabled={cancel.isPending}>取消任务</button>}
        </div>
        {actionError && <p className="field-error" role="alert">{actionError.message}</p>}
      </section>

      <section className="panel stack">
        <h2>生成参数</h2>
        <dl className="kv">
          <dt>提示词</dt><dd>{task.prompt}</dd>
          {task.negative_prompt && (<><dt>负向提示词</dt><dd>{task.negative_prompt}</dd></>)}
          <dt>视频方向</dt><dd>{task.resolution}</dd>
          <dt>时长</dt><dd className="num">{task.duration_seconds} 秒</dd>
          <dt>seed</dt><dd className="num">{task.seed ?? '未设置'}</dd>
          <dt>创建时间</dt><dd className="num">{formatTime(task.created_at)}</dd>
          {task.completed_at && (<><dt>完成时间</dt><dd className="num">{formatTime(task.completed_at)}</dd></>)}
          {task.retry_count > 0 && (<><dt>重试次数</dt><dd className="num">{task.retry_count}</dd></>)}
        </dl>
        {task.input_image_urls.length > 0 && (
          <ul className="thumbs" aria-label="参考图片">
            {task.input_image_urls.map((u, i) => <li key={u} className="thumb"><img src={u} alt={`参考图 ${i + 1}`} /></li>)}
          </ul>
        )}
      </section>

      <details className="panel disclosure">
        <summary>执行记录，排查问题用</summary>
        <ul className="log">
          {task.events.map((e, i) => (
            <li key={i}>
              <span className="num">{formatTime(e.created_at)}</span> {e.event_type}
              {e.to_status && <> 变为 {e.to_status}</>}
              {e.message && <span className="muted">，{e.message}</span>}
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
