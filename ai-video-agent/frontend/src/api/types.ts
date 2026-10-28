/** 后端统一响应结构（所有模块共用）。 */
export interface ApiEnvelope<T> {
  code: string
  message: string
  data: T
}

export interface UploadResult {
  file_id: string
  url: string
  content_type: string
  size_bytes: number
}
