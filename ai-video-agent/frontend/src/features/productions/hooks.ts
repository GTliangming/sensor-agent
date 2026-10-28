/** 生产流程的数据 hooks。页面只在系统自动处理的阶段轮询，停在审核点后不再刷新。 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { productionsApi } from './api'
import { isAutoProgressing } from './status'
import type { ProductionDetail } from './types'

const POLL_MS = 3000

export const productionKeys = {
  list: (accountId: string) => ['productions', 'list', accountId] as const,
  detail: (id: string) => ['productions', 'detail', id] as const,
}

export function useProductionList(accountId: string) {
  return useQuery({
    queryKey: productionKeys.list(accountId),
    queryFn: () => productionsApi.list({ page: 1, page_size: 100, account_id: accountId }),
    refetchInterval: (q) => (q.state.data?.items.some((i) => isAutoProgressing(i.status)) ? POLL_MS : false),
  })
}

export function useProduction(id: string) {
  return useQuery({
    queryKey: productionKeys.detail(id),
    queryFn: () => productionsApi.get(id),
    refetchInterval: (q) => (q.state.data && isAutoProgressing(q.state.data.status) ? POLL_MS : false),
  })
}

export function useCreateProduction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: productionsApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['productions', 'list'] }),
  })
}

/** 手动创建：和创建共用列表缓存失效逻辑。 */
export function useCreateManualProduction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: productionsApi.createManual,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['productions', 'list'] }),
  })
}

/** 手动创建页的预填提示词；方向变了才重新取（画幅比例会进入模板）。 */
export function useManualDraft(accountId: string, resolution: string) {
  return useQuery({
    queryKey: ['productions', 'manual-draft', accountId, resolution] as const,
    queryFn: () => productionsApi.manualDraft(accountId, resolution),
  })
}

/**
 * 审核/操作类 mutation：后端返回最新详情，直接写入缓存，界面立即切换到新状态；
 * 同时让列表失效，任务列表保持准确。
 */
export function useProductionAction<TArg>(id: string, fn: (id: string, arg: TArg) => Promise<ProductionDetail>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (arg: TArg) => fn(id, arg),
    onSuccess: (detail) => {
      qc.setQueryData(productionKeys.detail(id), detail)
      qc.invalidateQueries({ queryKey: ['productions', 'list'] })
    },
  })
}
