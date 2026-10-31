export interface ApiErrorBody {
  status: number
  error: string
  message: string
  timestamp: string
  fieldErrors?: { field: string | null; message: string }[]
}

export class ApiError extends Error {
  readonly status: number
  readonly body: ApiErrorBody | undefined
  /** Seconds to wait before retrying, from `Retry-After` on a 429. The server never sends 0. */
  readonly retryAfter: number | undefined

  constructor(response: Response, body: unknown) {
    const parsed = isApiErrorBody(body) ? body : undefined
    super(parsed?.message ?? `Request failed with status ${response.status}`)
    this.name = 'ApiError'
    this.status = response.status
    this.body = parsed
    const retryAfter = Number(response.headers.get('Retry-After'))
    this.retryAfter = retryAfter > 0 ? retryAfter : undefined
  }
}

function isApiErrorBody(body: unknown): body is ApiErrorBody {
  return typeof body === 'object' && body !== null && 'message' in body && 'status' in body
}
