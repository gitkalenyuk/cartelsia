import { CartesiaError } from './errors'

export interface RetryOpts {
  /** Максимум спроб (default 5) */
  maxAttempts?: number
  /** Базова затримка мс для exp backoff (default 800) */
  baseDelayMs?: number
  /** Кожна спроба логується */
  onRetry?: (attempt: number, delayMs: number, err: CartesiaError) => void
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Повтор запитів: retry ТІЛЬКИ 429 (concurrency_limited) та 5xx (server/network),
 * exp backoff + jitter, максимум 5 спроб. Інші 4xx НІКОЛИ не повторюються.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 5
  const baseDelay = opts.baseDelayMs ?? 800
  let lastErr: unknown

  // kind напряму — надійніше за instanceof (модуль може бути продубльований в тестах/бандлах)
  const kindOf = (err: unknown): string | undefined =>
    (err as { kind?: string } | null)?.kind

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const kind = kindOf(err)
      const knownKind =
        kind === 'concurrency_limited' ||
        kind === 'quota_exceeded' ||
        kind === 'auth' ||
        kind === 'not_found' ||
        kind === 'bad_request'
      const retryable = !knownKind || kind === 'concurrency_limited'
      if (!retryable || attempt === maxAttempts) throw err

      const backoff = Math.min(baseDelay * Math.pow(2, attempt - 1), 15000)
      const jitter = backoff * (0.75 + Math.random() * 0.5) // ±25%
      opts.onRetry?.(attempt, Math.round(jitter), err as CartesiaError)
      await sleep(Math.round(jitter))
    }
  }
  throw lastErr
}
