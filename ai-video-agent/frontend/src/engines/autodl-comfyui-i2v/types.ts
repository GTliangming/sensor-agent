/** AutoDL-ComfyUI 引擎的类型，与 backend/app/schemas/video.py 保持一致。 */

export type TaskStatus = 'pending' | 'submitted' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface CreateVideoPayload {
  /** 用哪个账号类型的生成配置（工作流、字段名、视频方向、时长上限等都来自它） */
  account_id: string
  prompt: string
  negative_prompt?: string
  image_ids: string[]
  resolution: string
  duration_seconds: number
  seed?: number
  /** night：随时创建，后台等夜间窗口再提交；now：立即提交 */
  run_mode: 'night' | 'now'
}

export interface TaskCreated {
  task_id: string
  status: TaskStatus
  created_at: string
}

export interface TaskListItem {
  task_id: string
  status: TaskStatus
  prompt_preview: string
  aspect_ratio: string
  resolution: string | null
  duration_seconds: number
  created_at: string
  updated_at: string
  video_url: string | null
  error_message: string | null
  schedule_mode: 'now' | 'window'
  queue_position: number | null
  expected_start_at: string | null
}

export interface TaskList {
  items: TaskListItem[]
  page: number
  page_size: number
  total: number
}

export interface TaskEvent {
  event_type: string
  from_status: string | null
  to_status: string | null
  message: string | null
  created_at: string
}

export interface TaskDetail {
  task_id: string
  status: TaskStatus
  prompt: string
  negative_prompt: string | null
  input_image_urls: string[]
  aspect_ratio: string
  resolution: string | null
  seed: number | null
  duration_seconds: number
  queue_position: number | null
  workflow_key: string
  created_at: string
  started_at: string | null
  completed_at: string | null
  error_code: string | null
  error_message: string | null
  retry_count: number
  can_retry: boolean
  video_url: string | null
  schedule_mode: 'now' | 'window'
  expected_start_at: string | null
  events: TaskEvent[]
}

export interface CancelResult {
  task_id: string
  status: TaskStatus
  external_cancelled: boolean
  note: string
}
