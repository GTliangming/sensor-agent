/** 统一的 fetch 封装：拆包 {code,message,data}，失败时抛出带错误码的 ApiError。 */
import type { ApiEnvelope } from './types'

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''
const API_PREFIX = '/api/v1'

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  query?: Record<string, string | number | boolean | undefined | null>
  json?: unknown
  form?: FormData
  headers?: Record<string, string>
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = new URL(`${BASE_URL}${API_PREFIX}${path}`, window.location.origin)
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }

  const headers: Record<string, string> = { ...opts.headers }
  let body: BodyInit | undefined
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.json)
  } else if (opts.form) {
    body = opts.form // 让浏览器自己设置 multipart 的 boundary
  }

  let resp: Response
  try {
    resp = await fetch(url, { method: opts.method ?? 'GET', headers, body })
  } catch {
    throw new ApiError('NETWORK_ERROR', '无法连接服务器，请检查网络或后端是否已启动', 0)
  }

  const payload = (await resp.json().catch(() => null)) as Partial<ApiEnvelope<T>> & {
    details?: Record<string, unknown>
  } | null
  if (!resp.ok || !payload || payload.code !== 'OK') {
    throw new ApiError(
      payload?.code ?? 'HTTP_ERROR',
      payload?.message ?? `请求失败（HTTP ${resp.status}）`,
      resp.status,
      payload?.details,
    )
  }
  return payload.data as T
}
