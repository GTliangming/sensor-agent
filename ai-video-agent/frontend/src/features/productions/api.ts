import { request } from '@/api/client'
import type {
  CreateProductionPayload, ProductionDetail, ProductionList, ProductionStatus, RunMode, SceneItem, SubtitleItem,
} from './types'

const post = (id: string, path: string, json?: unknown, query?: Record<string, boolean>) =>
  request<ProductionDetail>(`/productions/${id}/${path}`, { method: 'POST', json: json ?? {}, query })

export const productionsApi = {
  create: (payload: CreateProductionPayload) =>
    request<ProductionDetail>('/productions', { method: 'POST', json: payload }),

  list: (params: { page: number; page_size: number; account_id?: string; needs_review?: boolean; status?: ProductionStatus }) =>
    request<ProductionList>('/productions', { query: params }),

  get: (id: string) => request<ProductionDetail>(`/productions/${id}`),

  // 审核 A：分镜
  approveScene: (id: string, scenes?: SceneItem[]) => post(id, 'scene/approve', { scenes }),
  // 审核 B：台词与字幕
  approveDialogue: (id: string, edit?: { tts_text: string; subtitles: SubtitleItem[] }) =>
    post(id, 'dialogue/approve', edit ?? {}),
  backToScene: (id: string) => post(id, 'dialogue/back'),
  /** 审核 A / B 共用：带意见整体重新生成 */
  regenerate: (id: string, feedback: string) => post(id, 'regenerate', { feedback }),

  // 审核 C：成片
  approveVideo: (id: string) => post(id, 'video/approve'),
  regenerateVideo: (id: string, body: { scenes?: SceneItem[]; run_mode?: RunMode }) => post(id, 'video/regenerate', body),

  discard: (id: string, reason?: string) => post(id, 'discard', { reason }),
  markPublished: (id: string) => post(id, 'published'),
  retry: (id: string, confirmDuplicate = false) => post(id, 'retry', undefined, { confirm_duplicate: confirmDuplicate }),
}
