import { Link, useParams } from 'react-router-dom'
import { ErrorState, LoadingRows } from '@/shared/components/StateViews'
import { formatTime } from '@/shared/format'
import { productionsApi } from '../api'
import { DialogueReview } from '../components/DialogueReview'
import { SceneReview } from '../components/SceneReview'
import { ProgressInfo, StatusBadge, StepBar } from '../components/StatusParts'
import { PublishCopy, VideoReview, aspectOf } from '../components/VideoReview'
import { useProduction, useProductionAction } from '../hooks'
import { RUN_MODE_LABEL } from '../status'
import type { ProductionDetail } from '../types'
import { VideoPlayer } from '@/shared/components/VideoPlayer'

/** 根据当前状态决定主面板：审核点显示可编辑的审核面板，自动处理阶段显示进度说明。 */
function MainPanel({ p }: { p: ProductionDetail }) {
  const published = useProductionAction(p.id, (id: string, _: void) => productionsApi.markPublished(id))
  const retry = useProductionAction(p.id, productionsApi.retry)

  switch (p.status) {
    case 'scene_generating':
      return <section className="panel"><p>AI 正在生成主题、台词、字幕和分镜，页面会自动刷新。</p></section>
    case 'scene_review':
      return p.content ? <SceneReview key={p.content.version} production={p} /> : null
    case 'dialogue_review':
      return p.content ? <DialogueReview key={p.content.version} production={p} /> : null
    case 'queued':
      return (
        <section className="panel stack">
          <h2>排队中</h2>
          <ProgressInfo production={p} />
          <p className="muted">
            {p.run_mode === 'night' ? '夜间模式会等到夜间时段才提交到 GPU，提交后自动轮询结果，可以先离开。' : '等待 Worker 提交。'}
          </p>
        </section>
      )
    case 'generating':
      return (
        <section className="panel stack">
          <h2>视频生成中</h2>
          <ProgressInfo production={p} />
          <p className="muted">AutoDL 只返回状态和耗时，不提供百分比。已提交的任务无法中途取消，废弃后系统只是不再跟踪。</p>
        </section>
      )
    case 'video_review':
      return <VideoReview production={p} />
    case 'approved':
    case 'published':
      return (
        <section className="panel stack">
          <h2>{p.status === 'approved' ? '待发布' : '已发布'}</h2>
          {p.video?.video_url && <VideoPlayer src={p.video.video_url} aspectRatio={aspectOf(p.resolution)} />}
          <PublishCopy production={p} />
          {p.status === 'approved' && (
            <div className="actions">
              <button type="button" className="btn btn-primary" disabled={published.isPending} onClick={() => published.mutate()}>
                我已发布到视频号
              </button>
            </div>
          )}
        </section>
      )
    case 'failed': {
      const uncertain = p.video?.error_code === 'SUBMIT_UNCERTAIN'
      const doRetry = () => {
        if (uncertain && !window.confirm('上次提交结果不确定，外部任务可能仍在运行。重试可能产生重复费用，确定吗？')) return
        retry.mutate(uncertain)
      }
      return (
        <section className="panel state-error" role="alert">
          <h2>失败</h2>
          <p>{p.error_message}</p>
          {retry.error && <p className="field-error">{retry.error.message}</p>}
          <div className="actions">
            <button type="button" className="btn btn-primary" disabled={retry.isPending} onClick={doRetry}>重试</button>
          </div>
        </section>
      )
    }
    default:
      return <section className="panel"><p className="muted">该任务已废弃。</p></section>
  }
}

export function ProductionDetailPage() {
  const { productionId = '' } = useParams()
  const { data: p, isLoading, error, refetch } = useProduction(productionId)
  const discard = useProductionAction(productionId, (id: string, reason: string) => productionsApi.discard(id, reason))

  if (isLoading) return <LoadingRows rows={5} />
  if (error || !p) return <ErrorState message={error?.message ?? '任务不存在'} onRetry={() => refetch()} />

  function handleDiscard() {
    if (window.confirm('废弃后无法恢复；已提交到 GPU 的任务可能仍会产生费用。确定废弃吗？')) discard.mutate('手动废弃')
  }

  return (
    <div className="stack">
      <Link to=".." relative="path" className="btn-link">返回任务列表</Link>
      <header className="detail-head stack">
        <div className="row-between">
          <h1 className="detail-title">{p.topic || '主题由 AI 生成中'}</h1>
          <StatusBadge status={p.status} />
        </div>
        <StepBar status={p.status} />
      </header>

      <div className="detail-grid">
        <MainPanel p={p} />
        <aside className="panel stack" aria-label="生成参数">
          <h2>生成参数</h2>
          <dl className="kv">
            <dt>视频方向</dt><dd>{p.resolution}</dd>
            <dt>时长</dt><dd className="num">{p.duration_seconds} 秒</dd>
            <dt>seed</dt><dd className="num">{p.seed ?? '未设置'}</dd>
            <dt>生成时间</dt><dd>{RUN_MODE_LABEL[p.run_mode]}</dd>
            <dt>创建时间</dt><dd className="num">{formatTime(p.created_at)}</dd>
          </dl>
          {p.reference_images.length > 0 && (
            <ul className="thumbs" aria-label="参考图片">
              {p.reference_images.map((img, i) => (
                <li key={img.file_id} className="thumb"><img src={img.url} alt={`参考图 ${i + 1}`} /></li>
              ))}
            </ul>
          )}
          {p.allowed_actions.includes('discard') && (
            <div className="actions">
              <button type="button" className="btn btn-danger" disabled={discard.isPending} onClick={handleDiscard}>废弃该任务</button>
            </div>
          )}
          {discard.error && <p className="field-error" role="alert">{discard.error.message}</p>}
        </aside>
      </div>

      <details className="panel disclosure">
        <summary>版本与审核记录</summary>
        <h3>内容版本</h3>
        <ul className="log">
          {p.history.map((a) => (
            <li key={a.version}>
              <span className="num">{formatTime(a.created_at)}</span> 第 {a.version} 版，{a.source === 'llm' ? 'AI 生成' : '人工修改'}
              {a.feedback && <span className="muted">，意见：{a.feedback}</span>}
            </li>
          ))}
        </ul>
        <h3>审核记录</h3>
        <ul className="log">
          {p.reviews.map((r, i) => (
            <li key={i}>
              <span className="num">{formatTime(r.created_at)}</span> {r.stage}，{r.action}
              {r.comment && <span className="muted">，{r.comment}</span>}
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
