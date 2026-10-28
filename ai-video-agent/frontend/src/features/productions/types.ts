/** 生产流程类型，与 backend/app/schemas/production.py 保持一致。 */

export type ProductionStatus =
  | 'scene_generating' | 'scene_review' | 'dialogue_review'
  | 'queued' | 'generating' | 'video_review' | 'approved' | 'published' | 'failed' | 'discarded'

export type RunMode = 'night' | 'now'

export interface SceneItem {
  scene_id: number
  scene_desc: string
  action_desc: string
  camera_desc: string
}

export interface SubtitleItem {
  start: string
  end: string
  text: string
}

/** LLM 一次生成的完整业务数据。手动创建的任务没有台词和分镜，只有 manual、prompt、negative_prompt。 */
export interface ContentData {
  theme: string
  tts_text: string
  subtitles: SubtitleItem[]
  scenes: SceneItem[]
  manual?: boolean
  prompt?: string
  negative_prompt?: string
}

export interface Artifact {
  kind: 'content'
  version: number
  source: 'llm' | 'human'
  content: ContentData
  feedback: string | null
  created_at: string
}

export interface Review {
  stage: string
  action: string
  comment: string | null
  artifact_version: number | null
  created_at: string
}

export interface VideoInfo {
  task_id: string
  status: string
  video_url: string | null
  error_code: string | null
  error_message: string | null
  /** 排队中（未提交到 GPU）的顺序，从 1 开始 */
  queue_position: number | null
  started_at: string | null
  completed_at: string | null
  elapsed_seconds: number | null
  expected_start_at: string | null
}

export interface ProductionItem {
  id: string
  account_id: string
  account_name: string | null
  topic: string
  run_mode: RunMode
  status: ProductionStatus
  needs_review: boolean
  duration_seconds: number
  resolution: string
  created_at: string
  updated_at: string
  video: VideoInfo | null
}

export interface ProductionList {
  items: ProductionItem[]
  page: number
  page_size: number
  total: number
}

export interface ProductionDetail extends ProductionItem {
  seed: number | null
  failed_stage: string | null
  error_message: string | null
  allowed_actions: string[]
  content: Artifact | null
  history: Artifact[]
  reviews: Review[]
  reference_images: { file_id: string; url: string }[]
}

export interface CreateProductionPayload {
  account_id: string
  topic: string
  run_mode: RunMode
  duration_seconds: number
  resolution: string
  seed?: number
  reference_file_ids: string[]
}

export interface CreateManualPayload {
  account_id: string
  topic: string
  prompt: string
  negative_prompt: string
  run_mode: RunMode
  duration_seconds: number
  resolution: string
  seed?: number
  reference_file_ids: string[]
}

/** 手动创建时预填的提示词，由账号类型当前的模板渲染而来。 */
export interface ManualDraft {
  prompt: string
  negative_prompt: string
  /** 「镜头写法」「台词写法」模板原文，含 {{变量}} */
  shot_template: string
  dialogue_template: string
}
