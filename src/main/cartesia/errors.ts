export type ErrorKind =
  | 'quota_exceeded'
  | 'concurrency_limited'
  | 'auth'
  | 'not_found'
  | 'bad_request'
  | 'network'
  | 'server'
  | 'unknown'

export class CartesiaError extends Error {
  kind: ErrorKind
  status?: number
  errorCode?: string
  requestId?: string

  constructor(
    kind: ErrorKind,
    message: string,
    opts: { status?: number; errorCode?: string; requestId?: string } = {}
  ) {
    super(message)
    this.name = 'CartesiaError'
    this.kind = kind
    this.status = opts.status
    this.errorCode = opts.errorCode
    this.requestId = opts.requestId
  }
}

interface CartesiaErrorBody {
  error_code?: string
  title?: string
  message?: string
  request_id?: string
  // старі версії API можуть віддавати plain text або інші поля
  error?: string
}

/**
 * Класифікація ПО error_code, не по HTTP-статусу:
 * статус для quota_exceeded не задокументований Cartesia.
 */
export async function toCartesiaError(res: Response): Promise<CartesiaError> {
  let body: CartesiaErrorBody = {}
  let raw = ''
  try {
    raw = await res.text()
    body = JSON.parse(raw) as CartesiaErrorBody
  } catch {
    body = { message: raw.slice(0, 300) }
  }
  const code = body.error_code
  let message = body.message || body.title || body.error || raw.slice(0, 300) || `HTTP ${res.status}`
  if (code === 'plan_upgrade_required') {
    // перевірено на живому API (07.2026): клонування/локалізація вимагають платний тариф
    message =
      'Функція недоступна на безкоштовному тарифі Cartesia — потрібен платний план (від $5/міс) на акаунті цього ключа'
  }
  const opts = { status: res.status, errorCode: code, requestId: body.request_id }

  if (code === 'quota_exceeded') return new CartesiaError('quota_exceeded', message, opts)
  if (code === 'concurrency_limited' || res.status === 429)
    return new CartesiaError('concurrency_limited', message, opts)
  if (res.status === 401 || res.status === 403) return new CartesiaError('auth', message, opts)
  if (res.status === 404) return new CartesiaError('not_found', message, opts)
  if (res.status >= 500) return new CartesiaError('server', message, opts)
  if (res.status >= 400) return new CartesiaError('bad_request', message, opts)
  return new CartesiaError('unknown', message, opts)
}

export function asNetworkError(err: unknown): CartesiaError {
  if (err instanceof CartesiaError) return err
  const message = err instanceof Error ? err.message : String(err)
  return new CartesiaError('network', message)
}
