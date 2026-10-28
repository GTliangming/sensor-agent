import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { catalogApi } from '@/api/catalog'

export const useBusinessLines = () =>
  useQuery({ queryKey: ['business-lines'], queryFn: catalogApi.businessLines })

/** 当前工作区：由 URL 中的业务线与账号类型决定（状态放在 URL，刷新和分享链接都保持不变）。 */
export function useWorkspace() {
  const { lineKey, accountId } = useParams()
  const query = useBusinessLines()
  const line = query.data?.find((l) => l.key === lineKey)
  const account = line?.account_types.find((a) => a.id === accountId)
  return { ...query, line, account, lineKey: lineKey ?? '', accountId: accountId ?? '' }
}

export const workspacePath = (lineKey: string, accountId: string, tab = 'tasks') => `/${lineKey}/${accountId}/${tab}`
