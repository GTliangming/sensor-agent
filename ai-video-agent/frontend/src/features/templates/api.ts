import { request } from '@/api/client'

export type TemplateKind =
  | 'content' | 'content_user' | 'topic_suggest' | 'video_base' | 'video_character'
  | 'video_shot' | 'video_dialogue' | 'video_negative'

export interface Template {
  id: string
  group_id: string
  version: number
  kind: TemplateKind
  name: string
  account_id: string | null
  video_type: string | null
  platform: string | null
  body: string
  is_active: boolean
  created_at: string
}

export interface TemplateInput {
  name: string
  body: string
  account_id: string | null
  video_type: string | null
  platform: string | null
}

export interface TemplateMeta {
  variables: Record<string, string>
  kinds: Record<TemplateKind, string>
  /** 缺了就不能生成的种类 */
  required: TemplateKind[]
  /** 起步文本，仅供编辑器参考，运行时不读取 */
  starters: Record<TemplateKind, string>
}

export const templatesApi = {
  meta: () => request<TemplateMeta>('/templates/meta'),
  /** 传 accountId 时返回对该账号类型生效的模板（专属加通用） */
  list: (kind: TemplateKind, accountId: string) => request<Template[]>('/templates', { query: { kind, account_id: accountId } }),
  create: (kind: TemplateKind, body: TemplateInput) =>
    request<Template>('/templates', { method: 'POST', json: { kind, ...body } }),
  /** 保存 = 生成新版本，旧版本保留 */
  update: (id: string, body: TemplateInput) => request<Template>(`/templates/${id}`, { method: 'PUT', json: body }),
  remove: (id: string) => request<null>(`/templates/${id}`, { method: 'DELETE' }),
}
