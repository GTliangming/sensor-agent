/** 视频相关接口。页面和组件不直接写 URL，统一从这里调用。 */
import { request } from '@/api/client'
import type {
  CancelResult, CreateVideoPayload, TaskCreated, TaskDetail, TaskList, TaskStatus,
} from './types'

export const videosApi = {
  /** idempotencyKey：同一次“提交意图”使用同一个 key，重复点击不会重复生成。 */
  create: (payload: CreateVideoPayload, idempotencyKey: string) =>
    request<TaskCreated>('/videos', {
      method: 'POST', json: payload, headers: { 'Idempotency-Key': idempotencyKey },
    }),

  list: (params: { page: number; page_size: number; status?: TaskStatus }) =>
    request<TaskList>('/videos', { query: params }),

  get: (taskId: string) => request<TaskDetail>(`/videos/${taskId}`),

  retry: (taskId: string, confirmDuplicate = false) =>
    request<TaskCreated>(`/videos/${taskId}/retry`, {
      method: 'POST', query: { confirm_duplicate: confirmDuplicate },
    }),

  cancel: (taskId: string) => request<CancelResult>(`/videos/${taskId}/cancel`, { method: 'POST' }),
}
