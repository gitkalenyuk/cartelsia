/**
 * Browserless Clerk pipeline для cartesia.ai sign-up + key creation (E2E #8–#12).
 *
 * Повний цикл з fetch (без браузера, крім спільного specter-токену):
 *   0) specter token (SpecterProvider — один headless браузер на N потоків)
 *   1) POST /v1/client/sign_ups
 *   2) prepare_verification(email_code) → OTP з IMAP → attempt_verification
 *   3) protect_check(specter) → charon (v1/verify octet-stream) → protect_check(pot) → complete
 *   4) GET /v1/client → sessions[0].last_active_token.jwt
 *   5) POST https://backend.cartesia.ai/keys (Bearer jwt, {"description": ...}) → sk_car_
 *
 * Перевірено: scripts/probe_e2e8..e2e12. e2e12 = кінцева ключова ланка без браузера:
 *   GET /v1/client=200 jwt=1053 chars → POST /keys=201 sk_car_ (1s).
 */
import { chromium, type Browser } from 'playwright'

export const CLERK_BASE = 'https://clerk.cartesia.ai'
export const APP_ORIGIN = 'https://play.cartesia.ai'
export const BACKEND_BASE = 'https://backend.cartesia.ai'
const QS = '__clerk_api_version=2026-05-12&_clerk_js_version=6.30.1'

export const CARTESIA_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

export interface CartesiaHeaders {
  [k: string]: string
}

const baseHeaders = (): CartesiaHeaders => ({
  'Content-Type': 'application/x-www-form-urlencoded',
  'User-Agent': CARTESIA_UA,
  Origin: APP_ORIGIN,
  Referer: APP_ORIGIN + '/sign-in/create'
})

export interface ProtectCheck {
  status: string
  token?: string
  sdk_url?: string
  ui_hints?: { authz?: string; required_upload?: string; [k: string]: unknown }
  [k: string]: unknown
}

export interface SpecterToken {
  cid: string
  token: string
  /** epoch ms з s.ready (якщо Clerk видав); null = невідомо */
  exp: number | null
  fetchedAt: number
}

export interface SignUpFields {
  email: string
  first_name: string
  last_name: string
  password: string
  locale?: string
}

/**
 * Retry для прямий fetch-викликів (charon verify, POST /keys): повтор при
 * HTTP 429/502/503 з exponential backoff + jitter (до 2 повторів).
 */
async function retryTransient<T>(fn: () => Promise<T>, what: string): Promise<T> {
  let last: Error | null = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fn()
    } catch (e) {
      last = e instanceof Error ? e : new Error(String(e))
      if (!/ HTTP (429|502|503)/.test(last.message) || attempt === 3) throw last
      const delay = 2_000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 1_500)
      console.log('[clerk] ' + what + ' — retry ' + attempt + '/2 через ' + Math.round(delay / 1000) + 's')
      await new Promise((res) => setTimeout(res, delay))
    }
  }
  throw last ?? new Error('retryTransient: без помилок?')
}

/**
 * fetch з жорстким таймаутом. Вбудований fetch (undici) по дефолту може
 * мовчати ~5 хв на headers — один тихий сервер (charon/protect) заморозить
 * потік разом з рештою батчу. Тут — чіткий борт (30/60 с) і людський текст
 * помилки для accounts.txt / state.
 */
async function fetchWithTimeout(url: string, init: RequestInit, ms: number, what: string): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(ms) })
  } catch (e) {
    const name = e instanceof Error ? e.name : ''
    if (name === 'TimeoutError' || name === 'AbortError' || name.endsWith('TimeoutError')) {
      throw new Error(what + ': timeout ' + Math.round(ms / 1000) + 's — мережа мовчить')
    }
    throw e
  }
}

/** * Один об'єкт = один sign-up зі своїм cookie jar.
 * Різні об'єкти незалежні → N-паралелі без спільного стану.
 */
export class ClerkSigninClient {
  private ckMap = new Map<string, string>()

  private cookieStr(): string {
    return [...this.ckMap.entries()].map(([k, v]) => k + '=' + v).join('; ')
  }

  private absorb(r: Response): void {
    let set: string[] = []
    try {
      // undici/Node 18.14+: getSetCookie() — повний список Set-Cookie
      const anyR = r as unknown as { getSetCookie?: () => string[] }
      set = anyR.getSetCookie?.() ?? []
    } catch {
      set = []
    }
    if (set.length === 0) {
      const raw = r.headers.get('set-cookie')
      if (raw) set = [raw]
    }
    for (const c of set) {
      const p = c.split(';')[0]
      const i = p.indexOf('=')
      if (i > 0) this.ckMap.set(p.slice(0, i), p.slice(i + 1))
    }
  }

  /** Максимум спроб для rate-limit (429) / сервер-помилки (502/503). */
  static readonly MAX_ATTEMPTS = 5

  async clerk<T = unknown>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: URLSearchParams
  ): Promise<{ r: Response; b: string; j: T | null }> {
    const headers: Record<string, string> = { ...baseHeaders() }
    const ck = this.cookieStr()
    if (ck) headers['Cookie'] = ck
    for (let attempt = 1; ; attempt++) {
      const r = await fetchWithTimeout(
        CLERK_BASE + path,
        {
          method,
          headers,
          body: method === 'GET' ? undefined : body ? body.toString() : undefined
        },
        30_000,
        'clerk ' + method + ' ' + path.split('?')[0]
      )
      const b = await r.text()
      // Rate-limit / сервер: exponential backoff + jitter (поважає Retry-After)
      const retryable = r.status === 429 || r.status === 502 || r.status === 503
      if (retryable && attempt < ClerkSigninClient.MAX_ATTEMPTS) {
        const raSec = parseInt(r.headers.get('retry-after') || '', 10)
        const base = raSec > 0 ? raSec * 1000 : Math.min(30_000, 1_500 * 2 ** (attempt - 1))
        const delay = base + Math.floor(Math.random() * 1_500)
        console.log('[clerk] HTTP ' + r.status + ' on ' + path + ' — retry ' + attempt + '/' + (ClerkSigninClient.MAX_ATTEMPTS - 1) + ' через ' + Math.round(delay / 1000) + 's')
        this.absorb(r)
        await new Promise((res) => setTimeout(res, delay))
        continue
      }
      let j: T | null = null
      try {
        j = JSON.parse(b) as T
      } catch {
        j = null
      }
      this.absorb(r)
      return { r, b, j }
    }
  }

  /** POST /v1/client/sign_ups → sua id */
  async signUp(fields: SignUpFields): Promise<string> {
    const { r, j } = await this.clerk<{ response?: { id: string; status: string }; message?: string }>(
      'POST',
      '/v1/client/sign_ups?' + QS,
      new URLSearchParams({
        email_address: fields.email,
        first_name: fields.first_name,
        last_name: fields.last_name,
        password: fields.password,
        locale: fields.locale || 'en-US'
      })
    )
    const suaId = j?.response?.id
    if (!suaId) {
      throw new Error('sign_up failed: ' + (j?.message || 'no sign_up id (HTTP ' + r.status + ')'))
    }
    return suaId
  }

  async prepareVerification(suaId: string, strategy = 'email_code'): Promise<void> {
    await this.clerk(
      'POST',
      '/v1/client/sign_ups/' + suaId + '/prepare_verification?' + QS,
      new URLSearchParams({ strategy })
    )
  }

  async attemptVerification(suaId: string, code: string, strategy = 'email_code'): Promise<void> {
    await this.clerk(
      'POST',
      '/v1/client/sign_ups/' + suaId + '/attempt_verification?' + QS,
      new URLSearchParams({ code, strategy })
    )
  }

  /** POST /v1/client/sign_ins → sia id */
  async signIn(email: string, password: string): Promise<string> {
    const { r, j } = await this.clerk<{ response?: { id: string; status: string }; message?: string }>(
      'POST',
      '/v1/client/sign_ins?' + QS,
      new URLSearchParams({
        identifier: email,
        password: password,
        strategy: 'password'
      })
    )
    const siaId = j?.response?.id
    if (!siaId) {
      throw new Error('sign_in failed: ' + (j?.message || 'no sign_in id (HTTP ' + r.status + ')'))
    }
    return siaId
  }

  async prepareSecondFactor(siaId: string, strategy = 'email_code'): Promise<void> {
    await this.clerk(
      'POST',
      '/v1/client/sign_ins/' + siaId + '/prepare_second_factor?' + QS,
      new URLSearchParams({ strategy })
    )
  }

  async attemptSecondFactor(siaId: string, code: string, strategy = 'email_code'): Promise<void> {
    await this.clerk(
      'POST',
      '/v1/client/sign_ins/' + siaId + '/attempt_second_factor?' + QS,
      new URLSearchParams({ strategy, code })
    )
  }

  /**
   * protect_check #1: proof_token = specter token.
    await this.clerk(
      'POST',
      '/v1/client/sign_ups/' + suaId + '/attempt_verification?' + QS,
      new URLSearchParams({ code, strategy })
    )
  }

  /**
   * protect_check #1: proof_token = specter token.
   * Повертає protect_check (status=pending, cha token, sdk_url, authz) для charon.
   */
  async startProtectCheck(suaId: string, specterToken: string): Promise<ProtectCheck> {
    const { r, j } = await this.clerk<{ response?: { status: string; protect_check?: ProtectCheck }; message?: string }>(
      'PATCH',
      '/v1/client/sign_ups/' + suaId + '/protect_check?' + QS,
      new URLSearchParams({ proof_token: specterToken })
    )
    const pc = j?.response?.protect_check
    if (!pc) {
      throw new Error('protect_check missing (HTTP ' + r.status + '): ' + (j?.message || 'no protect_check'))
    }
    return pc
  }

  /**
   * Charon: POST <sdk_url>/v1/verify?challenge=<cha> з octet-stream тілом
   * (required_upload байтів) → { proof_token: pot }.
   */
  static async runCharon(protectCheck: ProtectCheck): Promise<string> {
    return retryTransient(() => ClerkSigninClient.charonOnce(protectCheck), 'charon verify (' + protectCheck.sdk_url?.slice(0, 40) + ')')
  }

  private static async charonOnce(protectCheck: ProtectCheck): Promise<string> {
    const verify = new URL('v1/verify', protectCheck.sdk_url || APP_ORIGIN)
    verify.searchParams.set('challenge', protectCheck.token || '')
    const reqUp = Math.max(0, parseInt((protectCheck.ui_hints || {}).required_upload || '0', 10) || 0)
    const vres = await fetchWithTimeout(
      verify.href,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          authorization: 'Bearer ' + ((protectCheck.ui_hints || {}).authz || '')
        },
        body: new Uint8Array(reqUp)
      },
      60_000,
      'charon verify'
    )
    if (!vres.ok) {
      const t = await vres.text().catch(() => '')
      throw new Error('charon verify HTTP ' + vres.status + ' ' + t.slice(0, 150))
    }
    const j = (await vres.json()) as { proof_token?: string }
    if (!j.proof_token) throw new Error('charon: no proof_token')
    return j.proof_token
  }

  /**
   * protect_check #2: proof_token = pot → sign_up status=complete.
   */
  async completeProtectCheck(suaId: string, pot: string): Promise<{
    status: string
    createdSessionId?: string
    createdUserId?: string
  }> {
    const { r, j } = await this.clerk<{
      response?: { status: string; created_session_id?: string; created_user_id?: string }
      message?: string
    }>('PATCH', '/v1/client/sign_ups/' + suaId + '/protect_check?' + QS, new URLSearchParams({ proof_token: pot }))
    const resp = j?.response
    if (!resp || resp.status !== 'complete') {
      throw new Error('complete PATCH failed (HTTP ' + r.status + ' status=' + (resp?.status || 'n/a') + ')')
    }
    return { status: resp.status, createdSessionId: resp.created_session_id, createdUserId: resp.created_user_id }
  }

  /**
   * GET /v1/client → last_active_token.jwt активного session.
   * Це сам токен, з яким frontend ходить на backend.cartesia.ai.
   */
  async getSessionJwt(): Promise<string | null> {
    const { r, j } = await this.clerk<{
      response?: { sessions?: { id?: string; status?: string; last_active_token?: { jwt?: string } }[] }
      sessions?: { id?: string; status?: string; last_active_token?: { jwt?: string } }[]
    }>('GET', '/v1/client?' + QS)
    const sessions = (j as { response?: { sessions?: unknown[] } })?.response?.sessions ?? (j as { sessions?: unknown[] })?.sessions
    if (!Array.isArray(sessions) || sessions.length === 0) {
      throw new Error('no sessions in /v1/client (HTTP ' + r.status + ')')
    }
    const s0 = sessions[0] as { status?: string; last_active_token?: { jwt?: string } }
    return s0?.last_active_token?.jwt ?? null
  }

  /** __client cookie — працює на .cartesia.ai для UI play.cartesia.ai. */
  get clientCookie(): string | null {
    return this.ckMap.get('__client') ?? null
  }
}

/**
 * Ствоєння API-ключу без браузера (E2E #12):
 *   POST https://backend.cartesia.ai/keys
 *   Authorization: Bearer <clerk jwt>
 *   Content-Type: application/json
 *   body: {"description": "..."}
 *   → 201 {"id","key":"sk_car_...","description","created_at"}
 *
 * GET того ж URL повертає {"data":[...]} (без секретів ключів — тільки іді).
 */
export interface CreatedKey {
  id: string
  key: string
  description?: string
  created_at?: string
}

export async function createApiKey(jwt: string, description = 'Cartel Key'): Promise<CreatedKey> {
  return retryTransient(() => createApiKeyOnce(jwt, description), 'POST /keys')
}

async function createApiKeyOnce(jwt: string, description: string): Promise<CreatedKey> {
  const r = await fetchWithTimeout(
    BACKEND_BASE + '/keys',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + jwt,
        'User-Agent': CARTESIA_UA,
        Origin: APP_ORIGIN,
        Referer: APP_ORIGIN + '/keys'
      },
      body: JSON.stringify({ description })
    },
    30_000,
    'POST /keys'
  )
  const b = await r.text()
  if (r.status !== 200 && r.status !== 201) {
    throw new Error('POST /keys HTTP ' + r.status + ' ' + b.slice(0, 200))
  }
  const j = JSON.parse(b) as CreatedKey
  if (!j.key || !j.key.startsWith('sk_car_')) {
    throw new Error('POST /keys: missing sk_car_ in response: ' + b.slice(0, 200))
  }
  return j
}

/**
 * SpecterProvider: window.__clerk_specter з headless-сторінки /sign-in/create.
 * ОДИН Browser спільний для всіх потоків; токен кешується (exp ~12h, fallback 30хв).
 * Specter — це перестійка (checkpoint) на сторінці sign-up; вона блокує fetch-цикл
 * без browserless token, тому браузер потрібен лише на цей крок.
 */
export class SpecterProvider {
  private browser: Browser | null = null
  private current: SpecterToken | null = null

  /** Повертає (possibly кешований) specter token. Створює браузер за потреби. */
  async ensure(): Promise<SpecterToken> {
    const now = Date.now()
    if (this.current && this.current.token) {
      const expSoon = this.current.exp !== null && this.current.exp - now < 5 * 60_000
      const tooOld = this.current.exp === null && this.current.fetchedAt + 30 * 60_000 < now
      if (!expSoon && !tooOld) return this.current
    }
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-gpu']
      })
    }
    const ctx = await this.browser.newContext({ userAgent: CARTESIA_UA })
    const page = await ctx.newPage()
    page.setDefaultTimeout(60_000)
    try {
      let lastErr: Error | null = null
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          await page.goto(APP_ORIGIN + '/sign-in/create', { waitUntil: 'domcontentloaded', timeout: 60_000 })
          for (let i = 0; i < 30; i++) {
            await page.waitForTimeout(1500)
            const ti = await page.title().catch(() => '')
            if (!/checkpoint/i.test(ti)) break
          }
          const hasSpecter = async (): Promise<boolean> =>
            page
              .evaluate(() => {
                const w = globalThis as unknown as { __clerk_specter?: unknown }
                return !!w.__clerk_specter
              })
              .catch(() => false)
          for (let i = 0; i < 60 && !(await hasSpecter()); i++) {
            await page.waitForTimeout(500)
          }
          if (!(await hasSpecter())) throw new Error('no window.__clerk_specter')
          const tok = await page.evaluate(async () => {
            const s = (globalThis as unknown as {
              __clerk_specter: { cid: string; ready: Promise<{ token?: string; exp?: number }> }
            }).__clerk_specter
            try {
              const rd = await Promise.race([
                Promise.resolve(s.ready).catch(() => null),
                new Promise<unknown>((r) => setTimeout(r, 15_000))
              ])
              const o = rd as { token?: string; exp?: number } | null
              return { cid: s.cid, token: (o?.token as string) || '', exp: (o?.exp as number) || null }
            } catch {
              return { cid: s.cid, token: '', exp: null }
            }
          })
          if (!tok.token) throw new Error('specter token empty')
          this.current = { ...tok, fetchedAt: Date.now() }
          return this.current
        } catch (e2) {
          lastErr = e2 instanceof Error ? e2 : new Error(String(e2))
          console.log('[specter] attempt ' + attempt + ': ' + lastErr.message.slice(0, 120))
          await page.goto('about:blank').catch(() => {})
          await new Promise((r2) => setTimeout(r2, 5000))
        }
      }
      throw lastErr ?? new Error('specter unavailable')
    } finally {
      await ctx.close().catch(() => {})
    }
  }

  async close(): Promise<void> {
    try {
      await this.browser?.close()
    } catch {
      /* ignore */
    }
    this.browser = null
    this.current = null
  }
}

/**
 * Повний browserless цикл ONE account: sign_up → OTP (зовнішній otpProvider)
 * → protect_check → charon → complete → JWT → key.
 * Повертає { email, pass, key } або кидатиме Error з людським повідомленням.
 */
export interface BrowserlessRegisterResult {
  email: string
  pass: string
  key: string
  session?: { createdSessionId?: string; createdUserId?: string }
}

export async function registerOneBrowserless(opts: {
  email: string
  pass: string
  specter: SpecterToken
  /** Повертає 6-значний OTP-код для email (IMAP ззовні) */
  otpProvider: (email: string) => Promise<string>
  keyDescription?: string
  signal?: AbortSignal
}): Promise<BrowserlessRegisterResult> {
  const { email, pass, specter, otpProvider } = opts
  const client = new ClerkSigninClient()
  const fail = (msg: string): never => {
    throw new Error(msg)
  }

  const suaId = await client.signUp({ email, first_name: 'Alex', last_name: 'Cartel', password: pass })
  const onAbort = (): void => fail('abort')
  if (opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true })

  try {
    await client.prepareVerification(suaId, 'email_code')
    const code = await otpProvider(email)
    if (!code || !/\d{4,8}/.test(code)) fail('OTP not found for ' + email)
    await client.attemptVerification(suaId, code)

    const pc = await client.startProtectCheck(suaId, specter.token)
    const pot = await ClerkSigninClient.runCharon(pc)
    const done = await client.completeProtectCheck(suaId, pot)

    const jwt = await client.getSessionJwt()
    if (!jwt) throw new Error('no session jwt after complete')

    const key = await createApiKey(jwt, opts.keyDescription ?? 'Cartel Key')
    return { email, pass, key: key.key, session: { createdSessionId: done.createdSessionId, createdUserId: done.createdUserId } }
  } finally {
    if (opts.signal) opts.signal.removeEventListener('abort', onAbort)
  }
}
