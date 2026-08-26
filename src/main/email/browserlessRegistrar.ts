/**
 * Browserless registrar: той самий публічний інтерфейс, що й PlaywrightRegistrar
 * (registerOne / launch / close / resume / cancelCaptcha / 'captcha'-еміції),
 * тільки під капотом — fetch-цикл clerkClient.ts + спільний SpecterProvider.
 *
 * Відмінності від Playwright-регістрара:
 *  - немає видимої вкладок на signup; єдиний headless-браузер — спільний
 *    SpecterProvider (запуск ~раз на 30хв-12h, токен кеше).
 *  - немає ручної капчі (Clerk specter/charon проходять автоматично).
 *  - реєстрація одного акаунта ~30-45 с (E2E #8–#13).
 */
import { EventEmitter } from 'events'
import type { BrowserWindow } from 'electron'
import type { CheckVerificationResult } from './imapClient'
import { ClerkSigninClient, SpecterProvider, createApiKey, type SpecterToken } from './clerkClient'
import type { RegisterResult } from './playwrightRegistrar'

export class BrowserlessRegistrar extends EventEmitter {
  private specter: SpecterProvider
  private captchaResolver: (() => void) | null = null
  private captchaRejecter: ((e: Error) => void) | null = null
  private closed = false

  constructor() {
    super()
    this.specter = new SpecterProvider()
  }

  /** Specter-браузер створюється lazy при першому ensure() — метод потрібен для сумісності. */
  async launch(): Promise<void> {
    /* intentionally empty: lazy */
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.specter.close()
  }

  resume(): void {
    if (this.captchaResolver) {
      this.captchaResolver()
      this.captchaResolver = null
      this.captchaRejecter = null
    }
  }

  cancelCaptcha(): void {
    if (this.captchaRejecter) {
      this.captchaRejecter(new Error('Користувач скасував'))
      this.captchaResolver = null
      this.captchaRejecter = null
    }
  }

  /**
   * Повний browserless цикл одного акаунта.
   * Сигнатура = PlaywrightRegistrar.registerOne (win/captchaTimeoutMs — для сумісності).
   */
  async registerOne(
    email: string,
    pass: string,
    checkEmailFn: () => Promise<CheckVerificationResult>,
    win: BrowserWindow | null,
    timeoutMs = 180_000,
    captchaTimeoutMs = 240_000
  ): Promise<RegisterResult> {
    void win
    const t0 = Date.now()
    const fail = (err: unknown, phase: string): RegisterResult => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[browserless] FAIL ' + email + ' phase=' + phase + ': ' + msg)
      return { success: false, email, pass, error: msg }
    }

    // 0) specter token (спільний, кешований)
    let specterToken: SpecterToken
    try {
      specterToken = await this.specter.ensure()
    } catch (e) {
      // specter — єдиний "браузерний" крок; якщо він упав, даємо шансу на ручне continue
      this.emit('captcha', {
        email,
        message: 'Specter не стартував (' + (e instanceof Error ? e.message : String(e)).slice(0, 80) + ') — "Готово" для повтору'
      })
      try {
        await new Promise<void>((resolve, reject) => {
          this.captchaResolver = resolve
          this.captchaRejecter = reject
          setTimeout(() => reject(new Error('specter captcha timeout')), captchaTimeoutMs)
        })
      } catch {
        /* cancelled/timeout */
      }
      try {
        specterToken = await this.specter.ensure()
      } catch (e2) {
        return fail(e2, 'specter')
      }
    }

    const client = new ClerkSigninClient()
    let suaId: string
    try {
      suaId = await client.signUp({ email, first_name: 'Alex', last_name: 'Cartel', password: pass, locale: 'en-US' })
    } catch (e) {
      return fail(e, 'sign_up')
    }

    try {
      await client.prepareVerification(suaId, 'email_code')
    } catch (e) {
      return fail(e, 'prepare_verification')
    }

    // 1) OTP з IMAP (зовнішня функція)
    const code = await this.waitForOtp(checkEmailFn, timeoutMs)
    if (!code) {
      return { success: false, email, pass, error: 'Лист підтвердження не прийшов (IMAP timeout)' }
    }
    console.log('[browserless] OTP found for ' + email + ' after ' + Math.round((Date.now() - t0) / 1000) + 's')

    try {
      await client.attemptVerification(suaId, code)
    } catch (e) {
      return fail(e, 'attempt_verification')
    }

    // 2) protect_check: specter → charon → pot → complete
    let pc
    try {
      pc = await client.startProtectCheck(suaId, specterToken.token)
    } catch (e) {
      return fail(e, 'start_protect_check')
    }
    let pot: string
    try {
      pot = await ClerkSigninClient.runCharon(pc)
    } catch (e) {
      return fail(e, 'charon')
    }
    let done: { status: string; createdSessionId?: string; createdUserId?: string }
    try {
      done = await client.completeProtectCheck(suaId, pot)
    } catch (e) {
      return fail(e, 'complete_protect_check')
    }
    console.log('[browserless] sign_up complete for ' + email + ' (sess=' + (done.createdSessionId || '?') + ')')

    // 3) JWT → key
    let jwt: string | null
    try {
      jwt = await client.getSessionJwt()
    } catch (e) {
      return { success: true, email, pass, error: 'account created, jwt: ' + (e instanceof Error ? e.message : String(e)) }
    }
    if (!jwt) {
      return { success: true, email, pass, error: 'account created, empty jwt — перевірте вручну' }
    }
    let key: string
    try {
      const created = await createApiKey(jwt, 'Cartel Key')
      key = created.key
    } catch (e) {
      return { success: true, email, pass, error: 'account created, key: ' + (e instanceof Error ? e.message : String(e)) }
    }

    console.log(
      '[browserless] OK ' + email + ' key=' + key.slice(0, 18) + '... total=' + Math.round((Date.now() - t0) / 1000) + 's'
    )
    return { success: true, email, pass, key }
  }

  private async waitForOtp(
    checkEmailFn: () => Promise<CheckVerificationResult>,
    timeoutMs: number
  ): Promise<string | null> {
    const t0 = Date.now()
    let lastLog = 0
    while (Date.now() - t0 < timeoutMs) {
      await new Promise((r) => setTimeout(r, 5000))
      try {
        const res = await checkEmailFn()
        if (res.found && res.code) return res.code
      } catch {
        /* transient IMAP */
      }
      const el = Math.round((Date.now() - t0) / 1000)
      if (el - lastLog >= 30) {
        lastLog = el
        console.log('[browserless] waiting OTP ... ' + el + 's')
      }
    }
    return null
  }
}
