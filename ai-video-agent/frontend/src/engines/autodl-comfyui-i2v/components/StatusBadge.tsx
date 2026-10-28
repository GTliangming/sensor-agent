import type { TaskStatus } from '../types'
import { STATUS_LABEL, toneOf } from '../status'

export function StatusBadge({ status }: { status: TaskStatus }) {
  return <span className={`badge tone-${toneOf(status)}`}>{STATUS_LABEL[status]}</span>
}
