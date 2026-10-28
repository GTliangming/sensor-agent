/** 业务线与账号类型：导航层级 业务线 -> 账号类型。账号类型自带它的生成配置（params）。 */
import { request } from './client'

export interface ResolutionOption {
  label: string
  aspect_ratio: string
  megapixels: number
  values: Record<string, unknown>
}

/** AutoDL 请求体字段名；留空表示不传。images/audios 是编号字段的前缀（如 ref_image_ 得到 ref_image_0…）。 */
export interface FieldMapping {
  prompt: string
  duration: string
  resolution: string
  seed: string
  negative_prompt: string
  dialogue: string
  images: string
  audios: string
  image_mode: 'base64' | 'url'
}

/** 存在数据库里的生成配置，与 backend/app/domain/generation_config.py 一致。 */
export interface GenerationConfig {
  config_version: number
  workflow_id: string
  seed: number | null
  min_duration: number
  max_duration: number
  default_duration: number
  max_images: number
  max_audios: number
  audio_enabled: boolean
  requires_image: boolean
  resolutions: ResolutionOption[]
  default_resolution: string | null
  fields: FieldMapping
  video_config: Record<string, unknown>
}

export interface AccountType {
  id: string
  slug: string
  name: string
  platform: string
  persona: string
  style_guide: string | null
  workflow_key: string
  params: GenerationConfig
  is_active: boolean
}

export interface BusinessLine {
  key: string
  name: string
  account_types: AccountType[]
}

export interface AccountTypeUpdate {
  name: string
  persona: string
  style_guide: string | null
  params: GenerationConfig
  is_active: boolean
}

export interface AccountTypeCreate {
  platform: string
  slug: string
  name: string
  persona: string
  copy_from: string
}

export const catalogApi = {
  businessLines: () => request<BusinessLine[]>('/business-lines'),
  update: (id: string, body: AccountTypeUpdate) => request<AccountType>(`/accounts/${id}`, { method: 'PUT', json: body }),
  /** 复制一个账号类型：连同生成配置和它的全部专属模板 */
  create: (body: AccountTypeCreate) => request<AccountType>('/accounts', { method: 'POST', json: body }),
  /** 让大模型想一个新主题（提示词用的是数据库里这个账号类型的「AI 想主题」模板） */
  suggestTopic: (id: string) => request<{ topic: string }>(`/accounts/${id}/suggest-topic`, { method: 'POST' }),
}
