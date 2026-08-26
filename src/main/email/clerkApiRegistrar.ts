/**
 * Clerk API Registrar: чистий fetch-цикл через Clerk REST API.
 * Без Specter/Charon — тільки email OTP (як наш Python-скрипт).
 *
 * Цикл одного акаунта:
 *   1) POST /v1/client/sign_ups → sua id
 *   2) prepare_verification(email_code) → OTP з IMAP → attempt_verification
 *   3) POST /v1/client/sign_ins → sia id
 *   4) prepare_second_factor(email_code) → OTP з IMAP → attempt_second_factor
 *   5) GET /v1/client → last_active_token.jwt
 *   6) POST https://backend.cartesia.ai/keys → sk_car_
 */
import { EventEmitter } from 'events'
import type { BrowserWindow } from 'electron'
import type { CheckVerificationResult } from './imapClient'
import type { RegisterResult } from './playwrightRegistrar'
import { ClerkSigninClient, createApiKey } from './clerkClient'

export class ClerkApiRegistrar extends EventEmitter {
  private closed = false

  async close(): Promise<void> {
    this.closed = true
  }

  resume(): void {
    // Немає ручної капчі — тільки OTP
  }

  cancelCaptcha(): void {
    // Немає ручної капчі
  }

  async registerOne(
    email: string,
    pass: string,
    checkEmailFn: () => Promise<CheckVerificationResult>,
    _win: BrowserWindow | null,
    timeoutMs = 180_000,
    _captchaTimeoutMs = 240_000
  ): Promise<RegisterResult> {
    const t0 = Date.now()
    const fail = (err: unknown, phase: string): RegisterResult => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[clerk-api] FAIL ${email} phase=${phase}: ${msg}`)
      return { success: false, email, pass, error: `${phase}: ${msg}` }
    }

    if (this.closed) {
      return fail(new Error('registrar closed'), 'init')
    }

    const client = new ClerkSigninClient()

    // === 1) Реєстрація ===
    let suaId: string
    try {
      suaId = await client.signUp({
        email,
        first_name: 'Alex',
        last_name: 'Cartel',
        password: pass,
        locale: 'en-US'
      })
    } catch (e) {
      return fail(e, 'sign_up')
    }

    try {
      await client.prepareVerification(suaId, 'email_code')
    } catch (e) {
      return fail(e, 'prepare_verification')
    }

    // === OTP для реєстрації ===
    const signupCode = await this.waitForOtp(checkEmailFn, timeoutMs)
    if (!signupCode) {
      return { success: false, email, pass, error: 'OTP для реєстрації не прийшов (IMAP timeout)' }
    }
    console.log(`[clerk-api] signup OTP for ${email}: ***${signupCode.slice(-2)}`)

    try {
      await client.attemptVerification(suaId, signupCode)
    } catch (e) {
      return fail(e, 'attempt_verification')
    }

    // === 2) Логін (щоб отримати JWT) ===
    let siaId: string
    try {
      siaId = await client.signIn(email, pass)
    } catch (e) {
      return fail(e, 'sign_in')
    }

    try {
      await client.prepareSecondFactor(siaId, 'email_code')
    } catch (e) {
      return fail(e, 'prepare_second_factor')
    }

    // === OTP для 2FA логіну ===
    const loginCode = await this.waitForOtp(checkEmailFn, timeoutMs)
    if (!loginCode) {
      return { success: false, email, pass, error: 'OTP для логіну не прийшов (IMAP timeout)' }
    }
    console.log(`[clerk-api] login OTP for ${email}: ***${loginCode.slice(-2)}`)

    try {
      await client.attemptSecondFactor(siaId, loginCode)
    } catch (e) {
      return fail(e, 'attempt_second_factor')
    }

    // === 3) JWT ===
    let jwt: string | null
    try {
      jwt = await client.getSessionJwt()
    } catch (e) {
      return fail(e, 'get_jwt')
    }
    if (!jwt) {
      return { success: false, email, pass, error: 'JWT порожній після логіну' }
    }

    // === 4) API Key ===
    let key: string
    try {
      const created = await createApiKey(jwt, 'Cartel Key')
      key = created.key
    } catch (e) {
      return fail(e, 'create_api_key')
    }

    console.log(
      `[clerk-api] OK ${email} key=${key.slice(0, 18)}... total=${Math.round((Date.now() - t0) / 1000)}s`
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
        console.log('[clerk-api] waiting OTP ... ' + el + 's')
      }
    }
    return null
  }
}
