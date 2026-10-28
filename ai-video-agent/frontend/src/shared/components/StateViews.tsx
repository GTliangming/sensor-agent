import type { ReactNode } from 'react'

/** 数据区域的四种状态之三：加载骨架、空、出错。第四种（有数据）由调用方绘制。 */
export function LoadingRows({ rows = 4, label = '加载中' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="skeleton-list">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton-row" />)}
    </div>
  )
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="state-box">
      <h3>{title}</h3>
      {hint && <p className="muted">{hint}</p>}
      {action}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state-box state-error" role="alert">
      <h3>加载失败</h3>
      <p>{message}</p>
      {onRetry && <button type="button" className="btn" onClick={onRetry}>重试</button>}
    </div>
  )
}
