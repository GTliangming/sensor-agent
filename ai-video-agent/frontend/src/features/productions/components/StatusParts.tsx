import { useEffect, useState } from 'react'
import { formatElapsed, formatTime } from '@/shared/format'
import { STATUS_LABEL, STEPS, stepIndex, toneOf } from '../status'
import type { ProductionItem, ProductionStatus } from '../types'

export function StatusBadge({ status }: { status: ProductionStatus }) {
  return <span className={`badge tone-${toneOf(status)}`}>{STATUS_LABEL[status]}</span>
}

/** 六步进度。失败和废弃时所有步骤保持未高亮，状态由徽标表达。 */
export function StepBar({ status, compact = false }: { status: ProductionStatus; compact?: boolean }) {
  const current = stepIndex(status)
  const finished = status === 'published'
  return (
    <ol className={compact ? 'steps steps-compact' : 'steps'} aria-label="生产进度">
      {STEPS.map((label, i) => {
        const state = finished || i < current ? 'done' : i === current ? 'current' : 'todo'
        return (
          <li key={label} className={`step step-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className={compact ? 'visually-hidden' : undefined}>{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

/** 每秒刷新一次的当前时间，只在需要实时显示（生成中）时才开启计时器。 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

/**
 * 状态旁的补充信息：排队顺序、预计开始时间、已耗时。
 * AutoDL 只返回状态和已耗时，不提供百分比，所以这里不画假的进度条。
 */
export function ProgressInfo({ production }: { production: Pick<ProductionItem, 'status' | 'video'> }) {
  const { status, video } = production
  const live = status === 'generating' && !!video?.started_at
  const now = useNow(live)

  if (status === 'scene_generating') return <span className="muted">AI 正在生成内容</span>
  if (status === 'queued') {
    return (
      <span className="muted">
        {video?.queue_position ? <>排队第 <strong className="num">{video.queue_position}</strong> 位</> : '等待提交'}
        {video?.expected_start_at && <><br />预计 {formatTime(video.expected_start_at)} 开始</>}
      </span>
    )
  }
  if (live && video?.started_at) {
    return <span className="muted">已耗时 <strong className="num">{formatElapsed((now - new Date(video.started_at).getTime()) / 1000)}</strong></span>
  }
  if (video?.elapsed_seconds != null && (status === 'video_review' || status === 'approved' || status === 'published')) {
    return <span className="muted">生成耗时 <span className="num">{formatElapsed(video.elapsed_seconds)}</span></span>
  }
  return null
}
