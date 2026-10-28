/** 数据请求 hooks（TanStack Query）。轮询逻辑集中在这里：任务进入终态后自动停止。 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { videosApi } from './api'
import { isTerminal } from './status'
import type { CreateVideoPayload } from './types'

const POLL_MS = 3000

export const queryKeys = {
  list: (page: number, pageSize: number) => ['videos', 'list', page, pageSize] as const,
  detail: (id: string) => ['videos', 'detail', id] as const,
}

export function useTaskList(page = 1, pageSize = 20) {
  return useQuery({
    queryKey: queryKeys.list(page, pageSize),
    queryFn: () => videosApi.list({ page, page_size: pageSize }),
    // 列表里还有未结束的任务时才轮询
    refetchInterval: (q) => (q.state.data?.items.some((i) => !isTerminal(i.status)) ? POLL_MS : false),
  })
}

export function useTask(taskId: string) {
  return useQuery({
    queryKey: queryKeys.detail(taskId),
    queryFn: () => videosApi.get(taskId),
    refetchInterval: (q) => (q.state.data && isTerminal(q.state.data.status) ? false : POLL_MS),
  })
}

export function useCreateVideo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ payload, key }: { payload: CreateVideoPayload; key: string }) =>
      videosApi.create(payload, key),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['videos', 'list'] }),
  })
}

/** 重试 / 取消后，列表和详情都要刷新。 */
function useTaskAction<TArg>(fn: (taskId: string, arg: TArg) => Promise<unknown>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, arg }: { taskId: string; arg: TArg }) => fn(taskId, arg),
    onSuccess: (_d, { taskId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.detail(taskId) })
      qc.invalidateQueries({ queryKey: ['videos', 'list'] })
    },
  })
}

export const useRetryTask = () => useTaskAction<boolean>((id, confirm) => videosApi.retry(id, confirm))
export const useCancelTask = () => useTaskAction<void>((id) => videosApi.cancel(id))
