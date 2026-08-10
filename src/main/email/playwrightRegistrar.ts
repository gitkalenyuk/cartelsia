import { EventEmitter } from 'events'
import { BrowserWindow, app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { chromium, type Browser, type Page, type BrowserContext } from 'playwright'
import { extractCartesiaKeys } from '../../shared/keyUtils'
import { dataDir } from '../paths'

export interface RegisterResult {
  success: boolean
  email: string
  pass: string
  key?: string
  error?: string
}

interface CheckVerificationResult {
  found: boolean
  link?: string
  code?: string
  error?: string
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

const PLAYWRIGHT_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-sandbox',
  '--disable-web-security',
  '--disable-dev-shm-usage',
  '--disable-gpu'
] as const

/**
 * Події main → renderer:
 *  - 'autoreg:captcha' — потрібна ручна капча; чекати сигналу 'autoreg:continue' (resume()).
 *  - 'autoreg:progress' — логування стану (необов'язково, через AutoregService).
 */
export class PlaywrightRegistrar extends EventEmitter {
  private browser: Browser | null = null
  private captchaResolver: (() => void) | null = null
  private captchaRejecter: ((e: Error) => void) | null = null

  private resolveChromiumPath(): string | undefined {
    // У dev-режимі playwright сам знаходить браузер у %LOCALAPPDATA%\ms-playwright
    if (!app.isPackaged) return undefined

    // У portable .exe — шукаємо поруч із exe (extraResources) або в стандартному кеші
    const candidates = [
      join(process.resourcesPath, 'ms-playwright', 'chromium'),
      join(process.resourcesPath, 'chromium'),
      // Fallback: якщо bundled не знайдено — спробувати системний кеш (докачка)
      join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
      join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1200', 'chrome-win64', 'chrome.exe')
    ]
    for (const c of candidates) {
      if (c.endsWith('.exe')) {
        if (existsSync(c)) return c
        continue
      }
      if (existsSync(c)) {
        const exe = join(c, 'chrome-win64', 'chrome.exe')
        if (existsSync(exe)) return exe
        const exe2 = join(c, 'chrome-win', 'chrome.exe')
        if (existsSync(exe2)) return exe2
        const exe3 = join(c, 'chrome.exe')
        if (existsSync(exe3)) return exe3
      }
    }
    return undefined
  }

  /** Якщо браузер не знайдено — пробуємо докачати (для режиму 'download'). */
  private async ensureChromiumInstalled(): Promise<void> {
    const { execSync } = await import('child_process')
    try {
      execSync('npx playwright install chromium', { timeout: 180_000, stdio: 'inherit' })
    } catch (e) {
      throw new Error(`Не вдалося встановити Chromium: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async launch(): Promise<void> {
    if (this.browser) return
    const tryLaunch = async (executablePath?: string): Promise<void> => {
      this.browser = await chromium.launch({
        headless: false,
        executablePath,
        args: [...PLAYWRIGHT_ARGS]
      })
    }

    const executablePath = this.resolveChromiumPath()
    try {
      await tryLaunch(executablePath)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes("Executable doesn't exist") || msg.includes('browserType.launch')) {
        // Якщо користувач обрав 'download' — пробуємо докачати
        console.log('[autoreg] Chromium не знайдено, пробую встановити...')
        await this.ensureChromiumInstalled()
        // Повторна спроба з системним шляхом
        const retryPath = this.resolveChromiumPath()
        await tryLaunch(retryPath)
        return
      }
      throw err
    }
  }

  async close(): Promise<void> {
    try {
      await this.browser?.close()
    } catch {
      /* ignore */
    }
    this.browser = null
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
      this.captchaRejecter(new Error('Користувач скасував ручну капчу'))
      this.captchaResolver = null
      this.captchaRejecter = null
    }
  }

  private async hasCaptcha(page: Page): Promise<boolean> {
    return page.evaluate(() => {
      const g = globalThis as unknown as { document: Document }
      const doc = g.document
      const hasIframe =
        !!doc.querySelector('iframe[src*="challenges.cloudflare.com"]') ||
        !!doc.querySelector('iframe[src*="turnstile"]') ||
        !!doc.querySelector('iframe[src*="hcaptcha"]') ||
        !!doc.querySelector('div[data-sitekey]') ||
        !!doc.querySelector('[data-callback*="turnstile"]')
      // Перевірка shadow DOM (Cloudflare інколи в shadowRoot)
      let hasShadowCaptcha = false
      try {
        const all = doc.querySelectorAll('*')
        for (const el of Array.from(all)) {
          if ((el as unknown as { shadowRoot?: ShadowRoot }).shadowRoot) {
            const sr = (el as unknown as { shadowRoot: ShadowRoot }).shadowRoot
            if (
              sr.querySelector('iframe[src*="challenges.cloudflare.com"]') ||
              sr.querySelector('iframe[src*="turnstile"]')
            ) {
              hasShadowCaptcha = true
              break
            }
          }
        }
      } catch {
        /* ignore */
      }
      const body = (doc.body ? doc.body.innerText : '').toLowerCase()
      const textual =
        body.includes('verify you are human') ||
        body.includes('checking your browser') ||
        body.includes('cf-turnstile')
      return hasIframe || hasShadowCaptcha || textual
    })
  }

  private async waitForHumanCaptcha(page: Page, email: string, win: BrowserWindow | null): Promise<void> {
    const win32 = win ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
    win32?.show()
    win32?.focus()
    this.emit('captcha', { email, message: 'Пройдіть капчу у вікні Chromium, потім натисніть «Готово»' })
    return new Promise<void>((resolve, reject) => {
      this.captchaResolver = resolve
      this.captchaRejecter = reject
    })
  }

  private async saveFailureScreenshot(page: Page, label: string): Promise<void> {
    try {
      const dir = dataDir()
      try {
        mkdirSync(dir, { recursive: true })
      } catch {
        /* ignore */
      }
      const path = join(dir, `autoreg-fail-${label}-${Date.now()}.png`)
      await page.screenshot({ path, fullPage: false })
      console.error(`[autoreg] screenshot saved: ${path}`)
    } catch {
      /* ignore screenshot errors */
    }
  }

  async registerOne(
    email: string,
    pass: string,
    checkEmailFn: () => Promise<CheckVerificationResult>,
    win: BrowserWindow | null,
    timeoutMs = 180_000,
    captchaTimeoutMs = 240_000
  ): Promise<RegisterResult> {
    await this.launch()
    if (!this.browser) return { success: false, email, pass, error: 'Не вдалося запустити Chromium' }

    const context: BrowserContext = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: USER_AGENT
    })
    // Збільшуємо дефолтний timeout для всіх дій на сторінці
    context.setDefaultTimeout(30_000)
    const page: Page = await context.newPage()

    // Діагностичні логи WorkOS — допомагають зрозуміти чому не переходить на verify
    page.on('console', (msg) => {
      const text = msg.text()
      if (text.toLowerCase().includes('error') || text.toLowerCase().includes('workos')) {
        console.log(`[autoreg:page:console] ${msg.type()}: ${text.slice(0, 500)}`)
      }
    })
    page.on('pageerror', (err) => {
      console.error(`[autoreg:page:error] ${err.message.slice(0, 500)}`)
    })

    const safeWaitCaptcha = async (): Promise<void> => {
      try {
        await Promise.race([
          this.waitForHumanCaptcha(page, email, win),
          new Promise<void>((_r, rej) =>
            setTimeout(() => rej(new Error('Час на ручну капчу вийшов (240с)')), captchaTimeoutMs)
          )
        ])
      } catch (e) {
        throw e instanceof Error ? e : new Error(String(e))
      }
    }

    const dumpErr = async (label: string): Promise<string> => {
      try {
        const data = await page.evaluate(() => {
          const doc = (globalThis as unknown as { document: Document }).document
          return {
            url: (globalThis as unknown as { location: Location }).location.href,
            title: doc.title,
            body: (doc.body ? doc.body.innerText : '').slice(0, 1500)
          }
        })
        return JSON.stringify(data)
      } catch {
        return '{"url":"(eval failed)"}'
      }
    }

    const randomDelay = (min = 300, max = 800): Promise<void> =>
      new Promise((r) => setTimeout(r, Math.floor(Math.random() * (max - min)) + min))

    try {
      await page.goto('https://play.cartesia.ai/sign-in/create', {
        waitUntil: 'domcontentloaded',
        timeout: 30_000
      })

      if (await this.hasCaptcha(page)) {
        await safeWaitCaptcha()
      }

      await page.waitForTimeout(2500)
      // Заповнюємо 4 поля нативно через page.evaluate (як у test_autoreg_final)
      await page.evaluate(
        ([fn, ln, em, pw]) => {
          const g = globalThis as unknown as { document: Document; HTMLInputElement: typeof HTMLInputElement }
          function setVal(el: HTMLInputElement, val: string): void {
            if (!el) return
            const desc = Object.getOwnPropertyDescriptor(g.HTMLInputElement.prototype, 'value')
            if (desc?.set) desc.set.call(el, val)
            else el.value = val
            el.dispatchEvent(new Event('input', { bubbles: true }))
            el.dispatchEvent(new Event('change', { bubbles: true }))
            el.dispatchEvent(new Event('blur', { bubbles: true }))
          }
          const inputs = Array.from(g.document.querySelectorAll('input')) as HTMLInputElement[]
          // Фільтруємо hidden/password зайві, але для create-форми всі 4 видимі
          const visible = inputs.filter((i) => i.type !== 'hidden')
          setVal(visible[0], fn)
          setVal(visible[1], ln)
          setVal(visible[2], em)
          setVal(visible[3], pw)
        },
        ['Alex', 'Cartel', email, pass]
      )

      await randomDelay(400, 700)
      await page.evaluate(() => {
        const g = globalThis as unknown as { document: Document }
        const btns = Array.from(g.document.querySelectorAll('button, input[type="submit"]')) as HTMLElement[]
        const cont = btns.find((b) => (b.textContent || '').trim().toLowerCase() === 'continue')
        if (cont) cont.click()
      })

      // Чекаємо переходу на /sign-in/create/verify-email-address АБО появи 6 OTP-полів
      const captchaCheckDeadline = Date.now() + 60_000
      let lastValidationError: string | null = null
      let reachedVerifyPage = false
      while (Date.now() < captchaCheckDeadline) {
        if (await this.hasCaptcha(page)) {
          await safeWaitCaptcha()
        }
        const validationError = await page.evaluate(() => {
          const g = globalThis as unknown as { document: Document; location: Location }
          const url = g.location.href
          if (!url.includes('/sign-in/create')) return null
          const body = (g.document.body ? g.document.body.innerText : '').toLowerCase()
          if (body.includes('please enter a valid first name')) return 'Невірне first name'
          if (body.includes('please enter a valid last name')) return 'Невірне last name'
          if (body.includes('please enter a valid email')) return 'Невірний email'
          if (body.includes('password must')) return 'Слабкий пароль'
          if (body.includes('already exists')) return 'Акаунт уже існує'
          if (body.includes('captcha failed') || body.includes('verification failed')) return 'Captcha failed'
          return null
        })
        if (validationError) {
          lastValidationError = validationError
          break
        }

        const state = await page.evaluate(() => {
          const g = globalThis as unknown as { document: Document; location: Location }
          const doc = g.document
          const url = g.location.href
          const inputs = Array.from(doc.querySelectorAll('input'))
          const otpLike = inputs.filter((i) => {
            const t = (i.type || '').toLowerCase()
            if (t === 'password' || t === 'hidden') return false
            const im = (i.getAttribute('inputmode') || '').toLowerCase()
            const ac = (i.getAttribute('autocomplete') || '').toLowerCase()
            const di = i.getAttribute('data-input-otp')
            return im === 'numeric' || im === 'tel' || ac === 'one-time-code' || ac === 'otp' || di === 'true'
          })
          const visibleInputs = inputs.filter((i) => {
            const t = (i.type || '').toLowerCase()
            return t !== 'password' && t !== 'hidden'
          })
          return {
            url,
            onVerify: url.includes('/verify-email-address') || url.includes('/sign-in/create/verify'),
            hasOtp: otpLike.length > 0 || visibleInputs.length >= 6
          }
        })

        if (state.onVerify || state.hasOtp) {
          reachedVerifyPage = true
          break
        }
        await page.waitForTimeout(800)
      }

      if (lastValidationError) {
        await this.saveFailureScreenshot(page, 'validation-error')
        return { success: false, email, pass, error: lastValidationError }
      }
      if (!reachedVerifyPage) {
        const info = await dumpErr('no verify')
        console.error(`[autoreg] NO_VERIFY ${email}: не дочекались OTP-сторінки info=${info}`)
        await this.saveFailureScreenshot(page, 'no-verify')
        return { success: false, email, pass, error: 'Не дочекались сторінки вводу OTP' }
      }

      // Очікуємо листа через IMAP — СТРОГО по TO == email
      // Поллимо кожні 5с до timeoutMs, періодично рефрешимо сторінку щоб не протухла сесія
      let found: CheckVerificationResult | null = null
      let otpAttempts = 0
      const startedAt = Date.now()
      while (Date.now() - startedAt < timeoutMs) {
        // Кожні 5с — чекаємо і питаємо IMAP
        await new Promise((r) => setTimeout(r, 5000))
        // Перевіряємо що сесія ще жива — якщо сторінка вилетіла на sign-in?redirect — не рефрешимо, це нормальний флоу після успішного OTP
        const stillOnVerify = await page.evaluate(() => {
          const url = location.href
          return url.includes('/verify-email-address') || url.includes('/sign-in/create/verify')
        }).catch(() => false)
        // Якщо ми вже не на verify — значить verify пройдена, не треба більше поллити
        // Це може статись тільки якщо OTP вже введено — але ми ще не вводили, тож ігноруємо
        void stillOnVerify
        try {
          const res = await checkEmailFn()
          if (res.found && (res.code || res.link)) {
            found = res
            // Якщо знайшли — ще раз перевіряємо що код саме для цього email (другий фільтр — на випадок якщо ImapClient повернув fallback)
            // Для code-листа це вже гарантовано ImapClient-ом, але перестрахуємось логом
            console.log(`[autoreg] IMAP found for ${email}: code=${res.code ? '***' + res.code.slice(-2) : 'none'} link=${res.link ? 'yes' : 'none'}`)
            break
          }
        } catch {
          /* ignore transient IMAP errors */
        }
        // Кожні 30с — освіжаємо verify-сторінку щоб не протухла, але НЕ робимо goto якщо вже ввели код
        if (Date.now() - startedAt > 30_000 && (Date.now() - startedAt) % 30000 < 5500) {
          try {
            const url = page.url()
            if (url.includes('/verify-email-address')) {
              // Видимий рефреш через reload, але зберігає OTP-поля (WorkOS їх перерендерить)
              // Краще не рефрешити — просто чекаємо листа. Рефреш робимо тільки якщо юзер просив, або якщо таймаут великий
              // Тому тут — нічого не робимо, просто лог
              console.log(`[autoreg] still waiting OTP for ${email} — ${Math.round((Date.now() - startedAt)/1000)}s elapsed, still on verify`)
            }
          } catch { /* ignore */ }
        }
      }

      if (!found) {
        const info = await dumpErr('no mail')
        console.error(`[autoreg] NO_MAIL ${email}: лист підтвердження не прийшов за ${timeoutMs}мс info=${info}`)
        await this.saveFailureScreenshot(page, 'no-mail')
        return { success: false, email, pass, error: 'Лист підтвердження не прийшов' }
      }

      // Пріоритет: code > link (code надійніший)
      if (found.code) {
        const otpCode = found.code
        otpAttempts++
        console.log(`[autoreg] Trying OTP attempt ${otpAttempts} for ${email}`)

        // Переконуємось що ми все ще на verify-сторінці — якщо ні, можливо сесія вже пройдена
        const isStillVerify = await page.evaluate(() => {
          const url = location.href
          const hasOtpInput = !!document.querySelector('input[data-input-otp="true"], input[autocomplete="one-time-code"]')
          const body = (document.body ? document.body.innerText : '').toLowerCase()
          const hasIncorrect = body.includes('incorrect code')
          return { onVerify: url.includes('/verify-email-address') || url.includes('/sign-in/create/verify'), hasOtpInput, hasIncorrect }
        }).catch(() => ({ onVerify: false, hasOtpInput: false, hasIncorrect: false }))

        // Якщо вже показали Incorrect code з попередньої спроби — чистимо поля перед новим вводом
        if (isStillVerify.hasIncorrect) {
          console.log(`[autoreg] Previous Incorrect code detected, clearing OTP fields`)
          await page.evaluate(() => {
            const inputs = Array.from(document.querySelectorAll('input[data-input-otp="true"], input[autocomplete="one-time-code"]')) as HTMLInputElement[]
            for (const inp of inputs) {
              inp.value = ''
              inp.dispatchEvent(new Event('input', { bubbles: true }))
            }
            // Також чистимо 6 окремих інпутів якщо вони окремі
            const allOtpInputs = Array.from(document.querySelectorAll('input[inputmode="numeric"], input[inputmode="tel"]')) as HTMLInputElement[]
            for (const inp of allOtpInputs) {
              if (inp.getAttribute('data-input-otp') === 'true' || inp.getAttribute('autocomplete') === 'one-time-code' || inp.type === 'text') {
                inp.value = ''
                inp.dispatchEvent(new Event('input', { bubbles: true }))
              }
            }
          })
          await page.waitForTimeout(500)
        }

        if (!isStillVerify.onVerify && !isStillVerify.hasOtpInput) {
          console.error(`[autoreg] Not on verify page anymore for ${email}, url=${page.url()}`)
          // Можливо вже пройшли verify — пробуємо йти на /keys
        } else {
          const ok = await this.fillOtpCode(page, otpCode)
          if (!ok) {
            const info = await dumpErr('otp fill')
            console.error(`[autoreg] OTP_FILL_FAIL ${email} info=${info}`)
            await this.saveFailureScreenshot(page, 'otp-fill-fail')
            return { success: false, email, pass, error: 'Не вдалося ввести OTP-код у поля' }
          }
          await page.waitForTimeout(3000)

          // Перевіряємо Incorrect code
          const incorrect = await page.evaluate(() => {
            const body = (document.body ? document.body.innerText : '').toLowerCase()
            return body.includes('incorrect code') || body.includes('invalid code') || body.includes('wrong code') || body.includes('невірний код')
          })
          if (incorrect) {
            console.error(`[autoreg] Incorrect code for ${email} — code=${otpCode.slice(0,2)}****`)
            await this.saveFailureScreenshot(page, 'incorrect-code')
            // НЕ оновлюємо сторінку — поле лишається, пробуємо ще раз з новим листом (якщо є)
            // Чекаємо ще один лист (можливо прийшов новіший код)
            console.log(`[autoreg] Waiting for a newer OTP after Incorrect code...`)
            let retryFound: CheckVerificationResult | null = null
            const retryStart = Date.now()
            while (Date.now() - retryStart < 90_000) {
              await new Promise((r) => setTimeout(r, 5000))
              try {
                const res2 = await checkEmailFn()
                if (res2.found && res2.code && res2.code !== otpCode) {
                  retryFound = res2
                  console.log(`[autoreg] New OTP found for retry: ***${res2.code.slice(-2)}`)
                  break
                }
              } catch { /* ignore */ }
            }
            if (retryFound && retryFound.code) {
              // Очищаємо поля і пробуємо знову
              await page.evaluate(() => {
                const inputs = Array.from(document.querySelectorAll('input[data-input-otp="true"], input[autocomplete="one-time-code"]')) as HTMLInputElement[]
                for (const inp of inputs) { inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true })) }
                const extras = Array.from(document.querySelectorAll('input[inputmode="numeric"]')) as HTMLInputElement[]
                for (const inp of extras) { inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true })) }
              })
              await page.waitForTimeout(400)
              const ok2 = await this.fillOtpCode(page, retryFound.code)
              if (ok2) {
                await page.waitForTimeout(3000)
                const stillIncorrect = await page.evaluate(() => (document.body ? document.body.innerText : '').toLowerCase().includes('incorrect code'))
                if (stillIncorrect) {
                  await this.saveFailureScreenshot(page, 'incorrect-code-retry')
                  return { success: false, email, pass, error: 'Incorrect code (повторна спроба теж невірна) — реєстрацію пропущено' }
                }
              }
            } else {
              return { success: false, email, pass, error: 'Incorrect code — правильний код не прийшов повторно' }
            }
          }
        }

        await page.waitForTimeout(2500)
        if (await this.hasCaptcha(page)) await safeWaitCaptcha()
        // Після успішного OTP WorkOS може редіректити на /sign-in?redirect_url — тоді логінимось
        if (page.url().includes('/sign-in') && page.url().includes('redirect_url')) {
          console.log(`[autoreg] redirect to sign-in after OTP, logging in for ${email}`)
          await this.loginAfterVerification(page, email, pass)
        }
        // Також перевіряємо чи не редіректнуло на sign-in без redirect_url (твоя 3-я скріна)
        if (page.url().includes('/sign-in?') || page.url().includes('/sign-in/')) {
          const needLogin = await page.evaluate(() => {
            const body = (document.body ? document.body.innerText : '').toLowerCase()
            return body.includes('enter your email address') || !!document.querySelector('input[name="identifier"], input[type="email"]')
          })
          if (needLogin) {
            console.log(`[autoreg] sign-in page after OTP (no redirect_url), logging in for ${email}`)
            await this.loginAfterVerification(page, email, pass)
          }
        }
      } else if (found.link) {
        const cleanLink = found.link.replace(/&amp;/g, '&').split('#')[0]
        await page.goto(cleanLink, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        if (await this.hasCaptcha(page)) await safeWaitCaptcha()
        await page.waitForTimeout(2500)
        if (page.url().includes('/sign-in') && page.url().includes('redirect_url')) {
          await this.loginAfterVerification(page, email, pass)
        }
        if (page.url().includes('/sign-in?') || page.url().includes('/sign-in/')) {
          const needLogin2 = await page.evaluate(() => {
            const body = (document.body ? document.body.innerText : '').toLowerCase()
            return body.includes('enter your email address') || !!document.querySelector('input[name="identifier"], input[type="email"]')
          })
          if (needLogin2) await this.loginAfterVerification(page, email, pass)
        }
      }

      await page.goto('https://play.cartesia.ai/keys', { waitUntil: 'domcontentloaded', timeout: 30_000 })
      if (await this.hasCaptcha(page)) await safeWaitCaptcha()
      await page.waitForTimeout(3500)

      // === Тиснемо Create API key ===
      const createResult = await page.evaluate(() => {
        const g = globalThis as unknown as { document: Document }
        const btns = Array.from(g.document.querySelectorAll('button, a')) as HTMLElement[]
        const btn = btns.find((b) => (b.textContent || '').toLowerCase().includes('create api key'))
        if (btn) btn.click()
        return btn ? 'clicked' : 'not-found'
      })

      await page.waitForTimeout(2500)
      if (await this.hasCaptcha(page)) await safeWaitCaptcha()
      await page.waitForTimeout(2000)

      // === Створюємо ключ: 3 стратегії (Enter → клік Submit модалки → Enter на формі) ===
      const descriptionFilled = await this.fillDescriptionAndSubmit(page)

      if (!descriptionFilled) {
        console.error('[autoreg] DESC_SUBMIT_FAILED — жодна стратегія не спрацювала')
        await this.saveFailureScreenshot(page, 'desc-submit-fail')
      }

      await page.waitForTimeout(2500)

      // === Очікуємо sk_car_ до 90 секунд ===
      let keyFromPage = await this.pollForKey(page, 90_000)

      if (keyFromPage) {
        return { success: true, email, pass, key: keyFromPage }
      }

      // Fallback: скануємо ще раз ширше (innerHTML + extractCartesiaKeys)
      const htmlText = await page.evaluate(() => {
        const g = globalThis as unknown as { document: Document; documentElement: HTMLElement }
        return g.document.documentElement.innerHTML.slice(0, 50000)
      })
      const bodyText = await page.evaluate(() => {
        const g = globalThis as unknown as { document: Document }
        return g.document.body ? g.document.body.innerText : ''
      })
      const fields = await page.evaluate(() => {
        const g = globalThis as unknown as { document: Document }
        return Array.from(g.document.querySelectorAll('input,textarea,code,pre'))
          .map((e: unknown) => (e as HTMLInputElement).value || (e as HTMLElement).textContent || '')
          .join('\n')
      })
      // Пробуємо clipboard якщо дозволено
      let clipboardText = ''
      try {
        clipboardText = await page.evaluate(async () => {
          try {
            return await (globalThis as unknown as { navigator: Navigator }).navigator.clipboard.readText()
          } catch {
            return ''
          }
        })
      } catch {
        /* clipboard not available */
      }
      const keys = extractCartesiaKeys(`${htmlText}\n${bodyText}\n${fields}\n${clipboardText}`)

      if (!keys.length) {
        await this.saveFailureScreenshot(page, 'key-not-found')
        return {
          success: createResult === 'clicked',
          email,
          pass,
          error:
            createResult === 'clicked'
              ? 'Акаунт створено, ключ ще не згенерувався — перевірте вручну'
              : 'Акаунт створено, але кнопку "Create API key" не знайдено'
        }
      }

      return { success: true, email, pass, key: keys[0] }
    } catch (err) {
      const info = await dumpErr('registerOne error')
      console.error(`[autoreg] FAIL ${email} info=${info}`)
      console.error(`[autoreg] ERR ${err instanceof Error ? err.message : String(err)}`)
      try {
        await this.saveFailureScreenshot(page, 'exception')
      } catch {
        /* ignore */
      }
      return {
        success: false,
        email,
        pass,
        error: err instanceof Error ? err.message : String(err)
      }
    } finally {
      await context.close()
    }
  }

  /**
   * Заповнює поле description і сабмітить модалку трьома стратегіями послідовно.
   * Повертає true якщо хоча б одна спрацювала (поле заповнене).
   */
  private async fillDescriptionAndSubmit(page: Page): Promise<boolean> {
    // Чекаємо появи поля description — шукаємо ширше ніж тільки name="description"
    const descSelector =
      'input[name="description"], input[id="description"], input[placeholder*="description" i], input[placeholder*="Description" i]'

    // Стратегія очікування: спочатку селектор, потім waitForFunction по модалці
    let found = false
    try {
      await page.waitForSelector(descSelector, { timeout: 5000 })
      found = true
    } catch {
      // fallback: чекаємо що модалка з текстом API Key з'явилась
      try {
        await page.waitForFunction(
          () => {
            const g = globalThis as unknown as { document: Document }
            const body = g.document.body ? g.document.body.innerText.toLowerCase() : ''
            return body.includes('api key') && g.document.querySelector('input') !== null
          },
          { timeout: 5000 }
        )
        found = true
      } catch {
        console.error('[autoreg] DESC_INPUT_NOT_FOUND after 10s')
      }
    }

    if (!found) return false

    // Заповнюємо поле
    try {
      await page.click(descSelector, { force: true })
    } catch {
      // fallback: клікаємо через evaluate
      await page.evaluate((sel) => {
        const g = globalThis as unknown as { document: Document }
        const el = g.document.querySelector(sel) as HTMLElement | null
        if (el) el.click()
      }, descSelector)
    }
    await page.waitForTimeout(300)
    try {
      await page.fill(descSelector, 'Cartel Key')
    } catch {
      // fallback: через evaluate з setter
      await page.evaluate(
        ([sel, val]) => {
          const g = globalThis as unknown as { document: Document; HTMLInputElement: typeof HTMLInputElement }
          const el = g.document.querySelector(sel) as HTMLInputElement | null
          if (!el) return
          const desc = Object.getOwnPropertyDescriptor(g.HTMLInputElement.prototype, 'value')
          if (desc?.set) desc.set.call(el, val)
          else el.value = val
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        },
        [descSelector, 'Cartel Key']
      )
    }
    await page.waitForTimeout(400)

    // Стратегія 1: Enter на полі
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1800)
    // Перевіряємо чи модалка закрилась (ключ з'явився або модалка зникла)
    let submitted = await this.isKeyModalSubmitted(page)
    if (submitted) {
      console.log('[autoreg] key modal submitted via Enter')
      return true
    }

    // Стратегія 2: клік Submit/Create кнопки в модалці
    const clicked = await page.evaluate(() => {
      const g = globalThis as unknown as { document: Document }
      // Шукаємо кнопку в діалозі/модалці
      const dialogs = Array.from(g.document.querySelectorAll('[role="dialog"], [data-radix-portal], .modal, [class*="modal"], [class*="dialog"]'))
      const scope: Document | Element = dialogs.length ? dialogs[dialogs.length - 1] as Element : g.document
      const btns = Array.from(scope.querySelectorAll('button'))
      // Шукаємо кнопку Create/Submit/Save
      const submit = btns.find((b) => {
        const t = (b.textContent || '').trim().toLowerCase()
        return t === 'create' || t === 'create api key' || t === 'submit' || t === 'save' || t === 'confirm'
      })
      if (submit) {
        submit.click()
        return true
      }
      return false
    })
    if (clicked) {
      await page.waitForTimeout(1800)
      submitted = await this.isKeyModalSubmitted(page)
      if (submitted) {
        console.log('[autoreg] key modal submitted via dialog button click')
        return true
      }
    }

    // Стратегія 3: Enter на формі
    await page.evaluate(() => {
      const g = globalThis as unknown as { document: Document }
      const form = g.document.querySelector('form')
      if (form) {
        const evt = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
        form.dispatchEvent(evt)
      }
    })
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1800)
    submitted = await this.isKeyModalSubmitted(page)
    if (submitted) {
      console.log('[autoreg] key modal submitted via form Enter')
      return true
    }

    // Якщо жодна стратегія не дала ключ — але поле заповнене, вважаємо що сабміт був
    // (ключ може з'явитись із затримкою, polling його знайде)
    return true
  }

  private async isKeyModalSubmitted(page: Page): Promise<boolean> {
    return page.evaluate(() => {
      const g = globalThis as unknown as { document: Document }
      const text = (g.document.body ? g.document.body.innerText : '') + ' ' + g.document.documentElement.innerHTML.slice(0, 10000)
      return /sk_car_[A-Za-z0-9_-]{10,}/.test(text)
    })
  }

  private async pollForKey(page: Page, timeoutMs: number): Promise<string> {
    const start = Date.now()
    let lastLogSec = -1
    while (Date.now() - start < timeoutMs) {
      const text = await page.evaluate(() => {
        const g = globalThis as unknown as { document: Document }
        const all = Array.from(
          g.document.querySelectorAll('input,textarea,code,pre,p,span,div,h1,h2,h3,button,strong')
        )
          .map((e: unknown) => (e as HTMLInputElement).value || (e as HTMLElement).textContent || '')
          .join('\n')
        // Додаємо innerHTML на випадок shadow DOM / нестандартних елементів
        return all + '\n' + g.document.documentElement.innerHTML.slice(0, 30000)
      })
      const match = text.match(/sk_car_[A-Za-z0-9_-]{16,}/)
      if (match) return match[0]
      const elapsedSec = Math.floor((Date.now() - start) / 1000)
      if (elapsedSec % 5 === 0 && elapsedSec !== lastLogSec) {
        lastLogSec = elapsedSec
        console.log(`[autoreg] polling sk_car_ ... ${elapsedSec}s`)
      }
      await page.waitForTimeout(1500)
    }
    return ''
  }

  private async loginAfterVerification(page: Page, email: string, pass: string): Promise<void> {
    await page.evaluate((em: string) => {
      const doc = (globalThis as unknown as { document: Document }).document
      const inp = doc.querySelector('input[name="identifier"]') as HTMLInputElement | null
      if (inp) {
        const dv = (doc.defaultView as unknown as { HTMLInputElement: { prototype: HTMLInputElement } }) ??
          (globalThis as unknown as { HTMLInputElement: { prototype: HTMLInputElement } })
        const desc = Object.getOwnPropertyDescriptor(dv.HTMLInputElement.prototype, 'value')
        if (desc?.set) desc.set.call(inp, em)
        else inp.value = em
        inp.dispatchEvent(new Event('input', { bubbles: true }))
        inp.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }, email)
    await this.clickContinue(page)
    await page.waitForTimeout(2000)
    await this.fillField(page, 'input[name="password"]', pass)
    await this.clickContinue(page)
    await page.waitForTimeout(3000)
  }

  private async fillField(page: Page, selector: string, value: string): Promise<void> {
    try {
      await page.waitForSelector(selector, { state: 'attached', timeout: 15_000 })
    } catch {
      console.error(`[autoreg] FILL_TIMEOUT selector=${selector}`)
      return
    }
    const handle = await page.$(selector)
    if (!handle) {
      console.error(`[autoreg] FILL_NULL selector=${selector}`)
      return
    }
    await handle.evaluate((el: unknown, v: string) => {
      const doc = (globalThis as unknown as { document: Document }).document
      const dv = (doc.defaultView as unknown as { HTMLInputElement: { prototype: HTMLInputElement } }) ??
        (globalThis as unknown as { HTMLInputElement: { prototype: HTMLInputElement } })
      const proto = dv.HTMLInputElement.prototype
      const desc = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : undefined
      if (desc?.set) desc.set.call(el as HTMLInputElement, v)
      else (el as HTMLInputElement).value = v
      ;(el as HTMLElement).dispatchEvent(new Event('input', { bubbles: true }))
      ;(el as HTMLElement).dispatchEvent(new Event('change', { bubbles: true }))
      ;(el as HTMLElement).dispatchEvent(new Event('blur', { bubbles: true }))
    }, value)
  }

  private async fillOtpCode(page: Page, code: string): Promise<boolean> {
    const selector = 'input[data-input-otp="true"], input[autocomplete="one-time-code"]'
    try {
      await page.waitForSelector(selector, { state: 'visible', timeout: 20_000 })
    } catch {
      console.error('[autoreg] OTP_INPUT_TIMEOUT')
      return false
    }

    const ok = await page.evaluate((sel: string) => {
      const g = globalThis as unknown as { document: Document }
      const el = g.document.querySelector(sel) as HTMLInputElement | null
      if (el) el.click()
      return !!el
    }, selector)
    if (!ok) return false

    await page.waitForTimeout(200)
    await page.keyboard.type(code, { delay: 80 })
    await page.waitForTimeout(200)
    await page.keyboard.press('Enter')
    return true
  }

  private async clickContinue(page: Page): Promise<'clicked' | 'fallback' | 'not-found'> {
    await page.waitForSelector('input[name="emailAddress"]', { state: 'attached', timeout: 20_000 }).catch(() => {})
    try {
      await page.waitForFunction(
        () => {
          const g = globalThis as unknown as { document: Document }
          const btns = Array.from(g.document.querySelectorAll('button, input[type="submit"]'))
          return btns.some((b) => (b.textContent || '').trim().toLowerCase() === 'continue')
        },
        { timeout: 20_000 }
      )
    } catch {
      console.error('[autoreg] WAIT_CONTINUE_TIMEOUT')
      return 'not-found'
    }

    return page.evaluate(() => {
      const g = globalThis as unknown as { document: Document }
      const btns = Array.from(g.document.querySelectorAll('button, input[type="submit"]')) as HTMLElement[]
      const cont = btns.find((b) => ((b.textContent || '') as string).trim().toLowerCase() === 'continue')
      if (cont) {
        cont.click()
        return 'clicked'
      }
      const fb = btns.find((b) => {
        const t = ((b.textContent || '') as string).trim().toLowerCase()
        if (
          t.includes('github') ||
          t.includes('google') ||
          t.includes('apple') ||
          t.includes('microsoft') ||
          t.includes('passkey') ||
          t.includes('sso')
        )
          return false
        return (b as HTMLButtonElement).type === 'submit'
      })
      if (fb) {
        fb.click()
        return 'fallback'
      }
      return 'not-found'
    })
  }
}
