/**
 * BrowserSignupRegistrar — рушій реєстрації через справжню форму play.cartesia.ai.
 *
 * Порт перевіреного Python-движка (REGER, серпень 2026): чистий Clerk API
 * soft-blocked (email верифікується, юзер НЕ створюється), тому реєстрація йде
 * у headless Chromium: Vercel checkpoint проходить автоматично → форма → OTP →
 * редирект на /start = реальний акаунт. API-ключ грабиться в ТОМУ Ж сеансі
 * одразу після реєстрації (повторний логін ловить Clerk protect-check).
 *
 * Кожна задача: окремий ephemeral Chromium (ізоляція фінгерпринта) через
 * опційний proxy → signup form → OTP з IMAP → /keys → sk_car_ ключ →
 * session state збережено у dataDir/sessions/<email>.json.
 */
import { EventEmitter } from 'events'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { app } from 'electron'
import type { RegisterResult } from './playwrightRegistrar'
import { fetchOtpOnce, type DirectImapConfig } from './imapDirectOtp'
import { dataDir } from '../paths'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'

const SIGNUP_URL = 'https://play.cartesia.ai/sign-up'
const KEYS_URL = 'https://play.cartesia.ai/keys'

const LAUNCH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-sandbox',
  '--disable-dev-shm-usage'
] as const

/** "http://user:pass@ip:port" → Playwright proxy descriptor */
export function toPlaywrightProxy(url: string | null | undefined): { server: string; username?: string; password?: string } | undefined {
  if (!url) return undefined
  const m = /^https?:\/\/([^@]+)@(.+)$/.exec(url)
  if (m) {
    const auth = m[1]
    const server = m[2]
    const c = auth.indexOf(':')
    return c >= 0
      ? { server: 'http://' + server, username: auth.slice(0, c), password: auth.slice(c + 1) }
      : { server: 'http://' + server, username: auth }
  }
  return { server: /^https?:\/\//.test(url) ? url : 'http://' + url }
}

export interface BrowserSignupOptions {
  /** Повертає наступний робочий проксі (або null = direct). Викликається перед кожною задачею. */
  proxyGetter?: () => string | null
  /** Шлях до теки збереження session-state (default dataDir()/sessions). */
  sessionsDir?: string
  headless?: boolean
  /** Прямий IMAP-конфіг для OTP (REGER-механізм: свіже з'єднання + HEADER To пошук). */
  imap?: DirectImapConfig
  /** Таймаут очікування OTP (мс). */
  otpTimeoutMs?: number
}

export class BrowserSignupRegistrar extends EventEmitter {
  private closed = false
  private sessionsDir: string
  proxyGetter: () => string | null
  headless: boolean
  imap: DirectImapConfig | null
  private otpTimeoutMs: number
  /** Проксі, вилучені penalty-механізмом під час поточного прогону (для логування). */
  removedProxies: string[] = []
  /** Проксі останньої виконаної задачі (для penalty-обліку ззовні). */
  _lastProxy: string | null = null
  /** Живий лог (для трансляції в UI через autoreg-log подію). */
  onLog: ((line: string) => void) | null = null
  /** fail-лічильники підряд по proxy-url. */
  private failCounts = new Map<string, number>()
  private proxyFailLimit = 2

  constructor(opts: BrowserSignupOptions = {}) {
    super()
    this.sessionsDir = opts.sessionsDir ?? join(dataDir(), 'sessions')
    this.proxyGetter = opts.proxyGetter ?? (() => null)
    this.headless = opts.headless ?? true
    this.imap = opts.imap ?? null
    this.otpTimeoutMs = opts.otpTimeoutMs ?? 170_000
    try { mkdirSync(this.sessionsDir, { recursive: true }) } catch { /* ignore */ }
  }

  resume(): void { /* ручної капчі немає */ }
  cancelCaptcha(): void { /* ручної капчі немає */ }

  async close(): Promise<void> {
    this.closed = true
  }

  /** Успішна рега скидає fail-лічильник проксі. */
  reportProxySuccess(proxy: string | null): void {
    if (proxy) this.failCounts.delete(proxy)
  }

  /** Фейл: 2 підряд → проксі вилучається з ротації. Повертає true, якщо вилучено. */
  reportProxyFailure(proxy: string | null): boolean {
    if (!proxy) return false
    const n = (this.failCounts.get(proxy) ?? 0) + 1
    this.failCounts.set(proxy, n)
    if (n >= this.proxyFailLimit) {
      this.failCounts.delete(proxy)
      this.removedProxies.push(proxy)
      return true
    }
    return false
  }

  private resolveChromiumPath(): string | undefined {
    if (!app.isPackaged) return undefined
    const candidates = [
      join(process.resourcesPath, 'ms-playwright', 'chromium'),
      join(process.resourcesPath, 'chromium'),
      join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
      join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1200', 'chrome-win64', 'chrome.exe')
    ]
    for (const c of candidates) {
      if (c.endsWith('.exe')) {
        if (existsSync(c)) return c
        continue
      }
      if (existsSync(c)) {
        for (const sub of ['chrome-win64', 'chrome-win', '']) {
          const exe = join(c, sub, 'chrome.exe')
          if (existsSync(exe)) return exe
        }
      }
    }
    return undefined
  }

  async registerOne(
    email: string,
    pass: string,
    _checkEmailFn?: unknown,
    _win: unknown = null,
    timeoutMs = 240_000,
    _captchaTimeoutMs = 240_000
  ): Promise<RegisterResult> {
    const t0 = Date.now()
    const tag = email.slice(0, email.indexOf('@'))
    const log = (msg: string): void => {
      console.log(`[browser-signup ${tag}] ${msg}`)
      try { this.onLog?.(`${tag}: ${msg}`) } catch { /* ignore */ }
    }
    const proxy = this.proxyGetter()
    this._lastProxy = proxy
    const pwProxy = toPlaywrightProxy(proxy)

    let browser: Browser | null = null
    try {
      if (this.closed) throw new Error('регістратор закритий')

      // Фаза A: запуск браузера + проходження checkpoint + дочекатись форми.
      // 2 спроби: кожна з НОВИМ проксі (proxyGetter викликається знову) —
      // checkpoint/проксі часто фейлять по одному разу, retry конвертує це в успіх.
      let ctx: BrowserContext | null = null
      let page: Page | null = null
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          if (attempt > 1) {
            log(`retry ${attempt}/2: новий проксі + свіжий браузер`)
            try { await browser?.close() } catch { /* ignore */ }
            browser = null
          }
          const attemptProxy = attempt === 1 ? proxy : this.proxyGetter()
          if (attempt > 1) this._lastProxy = attemptProxy
          browser = await chromium.launch({
            headless: this.headless,
            proxy: toPlaywrightProxy(attemptProxy),
            executablePath: this.resolveChromiumPath(),
            args: [...LAUNCH_ARGS]
          })
          ctx = await browser.newContext({
            userAgent: UA,
            locale: 'en-US',
            viewport: { width: 1366, height: 850 }
          })
          page = await ctx.newPage()

          // sign-up (Vercel checkpoint проходить сам ~6–10 c)
          // 90 c: під навантаженням повільні проксі встигають відкрити сторінку
          await page.goto(SIGNUP_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 })

          // Чекати форму (checkpoint переадресовує → /sign-in/create)
          let formOk = false
          for (let i = 0; i < 40; i++) {
            if (this.closed) throw new Error('stopped before form')
            await page.waitForTimeout(2_000)
            try {
              if (await page.locator('#emailAddress-field').count()) { formOk = true; break }
            } catch { /* navigation race */ }
          }
          if (formOk) break
          if (attempt === 2) throw new Error('форма реєстрації не з’явилась (checkpoint застряг після retry)')
          log('форма не з’явилась — перезапускаю з іншим проксі')
        } catch (e) {
          if (attempt === 2 || (e instanceof Error && e.message.startsWith('stopped'))) throw e
          log('фаза A не пройшла: ' + (e instanceof Error ? e.message.slice(0, 80) : String(e)))
        }
      }
      if (!browser || !ctx || !page) throw new Error('браузер не ініціалізовано')

      // 3) Заповнення форми
      const [first, ...rest] = (email.split('@')[0] || 'cartel user').replace(/[^a-zA-Z ]/g, ' ').trim().split(/\s+/)
      await page.fill('#firstName-field', first || 'Cartel', { timeout: 15_000 })
      await page.fill('#lastName-field', rest.join(' ') || 'User', { timeout: 15_000 })
      await page.fill('#emailAddress-field', email, { timeout: 15_000 })
      await page.fill('#password-field', pass, { timeout: 15_000 })
      await page.click("button:has-text('Continue')", { timeout: 15_000 })
      log('форма відправлена')

      // 4) Екран OTP
      let otpScreen = false
      let lastUrl = ''
      for (let i = 0; i < 45; i++) {
        if (this.closed) throw new Error('stopped before otp')
        await page.waitForTimeout(2_000)
        try {
          const url = page.url()
          lastUrl = url
          if (url.includes('/verify-email-address')) { otpScreen = true; break }
          const errCount = await page.locator('.cl-formFieldErrorText').count()
          if (errCount > 0 && url.includes('/sign-in/create')) {
            const body = await page.innerText('body').catch(() => '')
            throw new Error('помилка форми: ' + body.slice(0, 120))
          }
        } catch (e) {
          if (e instanceof Error && e.message.startsWith('помилка форми')) throw e
        }
      }
      if (!otpScreen) throw new Error('екран OTP не з’явився (url: ' + lastUrl.slice(0, 60) + ')')

      // 5) OTP через прямий IMAP (REGER-механізм: свіже з'єднання + HEADER To пошук)
      if (!this.imap) throw new Error('IMAP не налаштований (BrowserSignup.imap)')
      log('чекаю OTP (direct IMAP)...')
      const otpT0 = Date.now()
      let code: string | null = null
      while (Date.now() - otpT0 < this.otpTimeoutMs) {
        if (this.closed) throw new Error('stopped during otp wait')
        try {
          code = await fetchOtpOnce(this.imap, email)
          if (code) break
        } catch (e) {
          log('otp poll retry: ' + (e instanceof Error ? e.message.slice(0, 60) : String(e)))
        }
        await page.waitForTimeout(4_000)
      }
      if (!code) throw new Error('OTP не прийшов (таймаут IMAP)')
      log('OTP отримано')

      // 6) Ввести код: один input або 6 окремих
      const digitCount = await page.locator("input[inputmode='numeric']").count()
      if (digitCount <= 1) {
        const box = page.locator("input[inputmode='numeric']").first()
        await box.fill(code)
        await box.press('Enter').catch(() => {})
      } else {
        for (let j = 0; j < code.length && j < digitCount; j++) {
          await page.locator("input[inputmode='numeric']").nth(j).fill(code[j])
        }
      }
      // Кнопка Verify/Continue, якщо є
      for (const sel of ["button:has-text('Verify')", "button:has-text('Continue')"]) {
        try {
          const btn = page.locator(sel).first()
          if (await btn.count() && (await btn.isEnabled())) { await btn.click({ timeout: 5_000 }); break }
        } catch { /* continue */ }
      }
      log('код введено')

      // 7) Дочекатись входу (редирект на /start | /dashboard | /keys)
      let loggedIn = false
      for (let i = 0; i < 30; i++) {
        if (this.closed) throw new Error('stopped during verify')
        await page.waitForTimeout(2_000)
        try {
          if (/(start|dashboard|keys)/.test(new URL(page.url()).pathname)) { loggedIn = true; break }
        } catch { /* navigation race */ }
      }
      if (!loggedIn) throw new Error('верифікація не завершилась (немає редиректу)')
      log('ЗАРЕЄСТРОВАНО за ' + Math.round((Date.now() - t0) / 1000) + 's')

      // Session state → sessions/<email>.json (майбутні входи без логіну)
      try {
        await ctx.storageState({ path: join(this.sessionsDir, email + '.json') })
      } catch { /* best effort */ }

      // 8) Граб ключа в тому ж сеансі
      const key = await this.grabKey(page, log)
      if (key) log('KEY ' + key.slice(0, 18) + '... ' + Math.round((Date.now() - t0) / 1000) + 's')

      return { success: true, email, pass, key: key ?? undefined, error: key ? undefined : 'ключ не знайдено' }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      log('FAIL ' + msg.slice(0, 140))
      return { success: false, email, pass, error: msg.slice(0, 250) }
    } finally {
      try { await browser?.close() } catch { /* ignore */ }
      // Proxy penalty поза транзакцією браузера
      if (proxy) {
        // success/fail визначається return-значенням нижче, тому робимо це тут через замикання —
        // простіше: викликач (AutoregService) сам викликає reportProxySuccess/Failure.
      }
    }
  }

  /** /keys → знайти готовий ключ або створити новий. 3 кола очікування —
   *  під навантаженням сторінка може догружатись довго; між колами повторний goto. */
  async grabKey(page: Page, log: (m: string) => void): Promise<string | undefined> {
    for (let round = 1; round <= 3; round++) {
      if (round > 1) {
        log(`/keys спроба ${round}/3 (перегружаю сторінку)`)
        await page.goto(KEYS_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {})
      } else {
        log('відкриваю /keys')
        await page.goto(KEYS_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      }
      await page.waitForTimeout(6_000)

      // Уже є ключ у DOM?
      const existing = await this.findKeyInDom(page)
      if (existing) return existing

      // Кнопка Create API key (чек до 15 c на появу)
      let clicked = false
      for (const sel of ["button:has-text('Create API key')", "button:has-text('Create Key')", "button:has-text('Add key')"]) {
        try {
          const btn = page.locator(sel).first()
          await btn.waitFor({ state: 'visible', timeout: 15_000 })
          await btn.click({ timeout: 5_000 })
          clicked = true
          break
        } catch { /* наступний селектор */ }
      }
      if (!clicked) {
        try {
          const btns = page.locator('button', { hasText: /create/i })
          if (await btns.count()) { await btns.first().click({ timeout: 5_000 }); clicked = true }
        } catch { /* ignore */ }
      }
      if (!clicked) { log(`кнопку Create API key не знайдено (спроба ${round}/3)`); continue }

      await page.waitForTimeout(3_000)
      const desc = page.locator("input[placeholder*='description' i], input[name='description']")
      if (await desc.count()) {
        try { await desc.first().fill('Cartelsia auto', { timeout: 5_000 }); await page.waitForTimeout(800) } catch { /* ignore */ }
      }
      try {
        const create = page.locator("button:has-text('Create')").last()
        if (await create.count()) await create.click({ timeout: 5_000 })
      } catch { /* ignore */ }
      await page.waitForTimeout(5_000)
      const key = await this.findKeyInDom(page)
      if (key) return key
      log(`ключ не з’явився в DOM після створення (спроба ${round}/3)`)
    }
    return undefined
  }

  private async findKeyInDom(page: Page): Promise<string | undefined> {
    const rx = /sk_car_[a-zA-Z0-9_]{20,}/
    try {
      const m = rx.exec(await page.content())
      if (m) return m[0]
    } catch { /* ignore */ }
    // Reveal/copy кнопки
    try {
      const btns = page.locator('button', { hasText: /reveal|show|copy/i })
      const n = Math.min(await btns.count(), 3)
      for (let i = 0; i < n; i++) {
        try { await btns.nth(i).click({ timeout: 2_000 }); await page.waitForTimeout(700) } catch { /* ignore */ }
      }
      const m = rx.exec(await page.content())
      if (m) return m[0]
    } catch { /* ignore */ }
    try {
      const inputs = page.locator('input')
      const n = await inputs.count()
      for (let i = 0; i < n; i++) {
        const v = await inputs.nth(i).inputValue().catch(() => '')
        if (v.startsWith('sk_car_')) return v
      }
    } catch { /* ignore */ }
    return undefined
  }

  /**
   * Рятувальний прохід: акаунт зареєстрований, але ключ не знайдено в основному
   * прогоні (сторінка /keys не встигла догрузити). Відновлюємо session cookies з
   * sessions/<email>.json і повторно пробуємо /keys → Create API key.
   * Викликається після завершення пулу для всіх 'done-без-ключа' акаунтів.
   */
  async rescueKey(email: string): Promise<string | undefined> {
    const stateFile = join(this.sessionsDir, email + '.json')
    if (!existsSync(stateFile)) return undefined
    let browser: Browser | null = null
    try {
      browser = await chromium.launch({
        headless: this.headless,
        proxy: toPlaywrightProxy(this.proxyGetter()),
        executablePath: this.resolveChromiumPath(),
        args: [...LAUNCH_ARGS]
      })
      const ctx = await browser.newContext({
        userAgent: UA,
        locale: 'en-US',
        storageState: stateFile
      })
      const page = await ctx.newPage()
      const log = (m: string): void => {
        console.log(`[browser-signup rescue ${email.split('@')[0]}] ${m}`)
        try { this.onLog?.(`rescue ${email.split('@')[0]}: ${m}`) } catch { /* ignore */ }
      }
      const key = await this.grabKey(page, log)
      if (key) {
        // оновлюємо session (Create API key міг оновити токен)
        try { await ctx.storageState({ path: stateFile }) } catch { /* ignore */ }
        return key
      }
      return undefined
    } catch {
      return undefined
    } finally {
      try { await browser?.close() } catch { /* ignore */ }
    }
  }
}
