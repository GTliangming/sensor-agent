import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { templatesApi, type TemplateInput, type TemplateKind } from './api'

export const useTemplates = (kind: TemplateKind, accountId: string) =>
  useQuery({ queryKey: ['templates', kind, accountId], queryFn: () => templatesApi.list(kind, accountId) })

export const useTemplateMeta = () =>
  useQuery({ queryKey: ['templates', 'meta'], queryFn: templatesApi.meta, staleTime: Infinity })

export function useSaveTemplate(kind: TemplateKind, editingId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: TemplateInput) =>
      editingId ? templatesApi.update(editingId, body) : templatesApi.create(kind, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  })
}

export function useRemoveTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: templatesApi.remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  })
}
