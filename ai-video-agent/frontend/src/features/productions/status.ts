import type { ProductionItem, ProductionStatus } from './types'

export const STATUS_LABEL: Record<ProductionStatus, string> = {
  scene_generating: '生成内容中',
  scene_review: '待审核分镜',
  dialogue_review: '待审核台词',
  queued: '排队中',
  generating: '视频生成中',
  video_review: '待审核成片',
  approved: '待发布',
  published: '已发布',
  failed: '失败',
  discarded: '已废弃',
}

export type Tone = 'review' | 'busy' | 'ok' | 'bad' | 'muted'

const TONE: Record<ProductionStatus, Tone> = {
  scene_generating: 'busy', queued: 'busy', generating: 'busy',
  scene_review: 'review', dialogue_review: 'review', video_review: 'review',
  approved: 'ok', published: 'ok', failed: 'bad', discarded: 'muted',
}

export const toneOf = (s: ProductionStatus): Tone => TONE[s]

/** 系统正在自动处理中（页面需要轮询）；停在审核点或终态时不再轮询。 */
export const isAutoProgressing = (s: ProductionStatus) =>
  s === 'scene_generating' || s === 'queued' || s === 'generating'

export const isReviewStatus = (s: ProductionStatus) =>
  s === 'scene_review' || s === 'dialogue_review' || s === 'video_review'

/** 进度的六个步骤。 */
export const STEPS = ['生成内容', '审核分镜', '审核台词', '生成视频', '审核成片', '发布'] as const

/** 当前所处步骤（0 起）；失败和废弃返回 -1。 */
export function stepIndex(s: ProductionStatus): number {
  switch (s) {
    case 'scene_generating': return 0
    case 'scene_review': return 1
    case 'dialogue_review': return 2
    case 'queued': case 'generating': return 3
    case 'video_review': return 4
    case 'approved': case 'published': return 5
    default: return -1
  }
}

export const RUN_MODE_LABEL = { now: '立即生成', night: '夜间生成' } as const

/** 列表筛选，放在 URL 的 filter 参数里。 */
export const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'review', label: '待审核' },
  { key: 'running', label: '进行中' },
  { key: 'done', label: '已完成' },
] as const
export type FilterKey = (typeof FILTERS)[number]['key']

export function matchesFilter(p: ProductionItem, f: FilterKey): boolean {
  if (f === 'review') return isReviewStatus(p.status)
  if (f === 'running') return isAutoProgressing(p.status)
  if (f === 'done') return p.status === 'approved' || p.status === 'published'
  return true
}
