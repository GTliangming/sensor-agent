import type { TaskStatus } from './types'

export const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: '排队中',
  submitted: '已提交',
  running: '生成中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

/** 状态徽标的色调，与生产流程的徽标共用同一套样式。 */
export const toneOf = (s: TaskStatus) =>
  s === 'succeeded' ? 'ok' : s === 'failed' ? 'bad' : s === 'cancelled' ? 'muted' : 'busy'

/** 终态：不会再变化，可以停止轮询。 */
export const isTerminal = (s: TaskStatus) => s === 'succeeded' || s === 'failed' || s === 'cancelled'

export const isActive = (s: TaskStatus) => !isTerminal(s)

export type RunMode = 'night' | 'now'
export const RUN_MODE_LABEL: Record<RunMode, string> = { now: '立即生成', night: '夜间生成' }
