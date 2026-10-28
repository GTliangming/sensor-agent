import { request } from './client'
import type { UploadResult } from './types'

/** 图片上传：账号参考图、手动生成的参考图都走这里。 */
export const uploadsApi = {
  uploadImage: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<UploadResult>('/uploads', { method: 'POST', form })
  },
}
