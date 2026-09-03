import { EventEmitter } from 'events'
import { appendFileSync } from 'fs'
import { join } from 'path'
import { BrowserWindow } from 'electron'
import { ImapClient } from './imapClient'
import type { RegisterResult } from './playwrightRegistrar'
import type { CheckVerificationResult } from './imapClient'
import type { KeyPool } from '../keys/keyPool'
import type { ImapConfig, CaptchaProvider } from '../../shared/types'
import { dataDir, outputDir } from '../paths'
import { genEmailLocal, genName, type EmailStyle } from './identity'
import {
  clearState,
  emptyState,
  readState,
  resumableItems,
  summarize,
  writeState,
  type AutoregResumeItem,
  type AutoregResumePhase,
  type AutoregResumeState,
} from './autoregState'

export type AutoregState =
  | 'queued'
  | 'form'
  | 'waiting-mail'
  | 'verifying'
  | 'creating-key'
  | 'done'
  | 'failed'
  | 'cancelled'

export interface AutoregItem {
  id: string
  email: string
  pass: string
  state: AutoregState
  key?: string
  error?: string
  /** 2.1.2: людські імʼя/прізвище для форми (генеруються разом з email) */
  name?: { first: string; last: string }
}

export interface AutoregOptions {
  count: number
  catchAllDomain: string
  imapConfig: ImapConfig
  captchaProvider?: CaptchaProvider
  captchaApiKey?: string
  concurrency?: number // кількість паралельних потоків, 1 = підряд (default)
  delayMs?: number // пауза між акаунтами (ms), 0 = без паузи
  batchSize?: number // якщо задано — пачка з паузою, інакше всі підряд
}

/** 2.1.2: постачальник налаштувань (ставиться з handlers, щоб уникнути циклічних імпортів) */
let settingsSnapshot: () => import('../../shared/types').AutoregSettings = () => ({})
export function setAutoregSettingsProvider(fn: () => import('../../shared/types').AutoregSettings): void {
  settingsSnapshot = fn
}

function randStr(len: number, alphabet: string): string {
  let s = ''
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)]
  return s
}

/** 2.1.2: email через identity-модуль (без бренд-слів; стиль з налаштувань) */
function genEmail(domain: string, style: EmailStyle = 'random', prefix?: string): string {
  return `${genEmailLocal(style, prefix)}@${domain}`
}

function genPass(): string {
  // 2.1.2: пароль більше не містить бренд-слова
  const upper = randStr(5, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')
  const digits = randStr(2, '0123456789')
  const lower = randStr(2, 'abcdefghijklmnopqrstuvwxyz')
  return `Xq_${upper}${digits}${lower}!9`
}

function appendAccountsLine(email: string, pass: string, key?: string, err?: string): void {
  const line = `${new Date().toISOString().slice(0, 19).replace('T', ' ')} | Email: ${email} | Pass: ${pass} | Key: ${key || 'no-key'} | ${err || 'ok'}\n`
  try { appendFileSync(join(dataDir(), 'accounts.txt'), line, 'utf8') } catch {}
  try { appendFileSync(join(outputDir(), 'accounts.txt'), line, 'utf8') } catch {}
}

/** Ключі — в окремий файл (тільки sk_car_..., по одному на рядок) одразу після грабінгу. */
export function appendKeyLine(key: string): void {
  for (const dir of [dataDir(), outputDir()]) {
    try { appendFileSync(join(dir, 'api_keys.txt'), key + '\n', 'utf8') } catch { /* best effort */ }
  }
}

/** Публічний інтерфейс рушія реєстрації (PlaywrightRegistrar і BrowserlessRegistrar структурно сумісні). */
export interface RegistrarEngine {
  registerOne(
    email: string,
    pass: string,
    /** Легасі-callback (старі рушії). BrowserSignup отримує OTP прямим IMAP сам. */
    checkEmailFn?: () => Promise<CheckVerificationResult>,
    win?: BrowserWindow | null,
    timeoutMs?: number,
    captchaTimeoutMs?: number,
    /** 2.1.2: людські імʼя/прізвище для форми */
    name?: { first: string; last: string }
  ): Promise<RegisterResult>
  close(): Promise<void>
  resume(): void
  cancelCaptcha(): void
  on(event: 'captcha', listener: (payload: { email: string; message: string }) => void): unknown
  off(event: 'captcha', listener: (payload: { email: string; message: string }) => void): unknown
}

export class AutoregService extends EventEmitter {
  private items: AutoregItem[] = []
  private running = false
  private cancelled = false
  private currentIndex = -1
  /** Персист resume-стану з run(); доступний для interrupt(). */
  private persistTimer: NodeJS.Timeout | null = null
  private flushPersist: (() => void) | null = null

  constructor(
    private registrar: RegistrarEngine,
    private pool: KeyPool
  ) {
    super()
  }

  /** Гаряча заміна рушія (playwright / browserless) перед запуском. */
  setRegistrar(r: RegistrarEngine): void {
    this.registrar = r
  }

  isRunning(): boolean {
    return this.running
  }

  getItems(): AutoregItem[] {
    return [...this.items]
  }

  cancel(): void {
    this.cancelled = true
    this.registrar.cancelCaptcha()
  }

  /**
   * 2.1.2: ЖОРСТКА зупинка: прапор cancelled + негайне вбивство всіх живих
   * браузерів (in-flight registerOne кидає помилку і потоки завершуються швидко).
   */
  async stop(): Promise<void> {
    this.cancel()
    const bs = this.registrar as import('./browserSignupRegistrar').BrowserSignupRegistrar
    if (typeof bs.killAll === 'function') {
      try { await bs.killAll() } catch { /* ignore */ }
    }
  }

  /**
   * Зовнішнє переривання (app quit / uncaughtException / unhandledRejection):
   * in-flight items → 'failed' з причиною + синхронний persist без дебаусу —
   * стан завжди resume-бельний, «заморожений form» не лишається.
   * 'queued' лишається 'queued': resume=true продовжить з них без втрат.
   */
  interrupt(reason: string): void {
    if (!this.running) return
    const inFlight: AutoregState[] = ['form', 'waiting-mail', 'verifying', 'creating-key']
    let changed = false
    for (const it of this.items) {
      if (inFlight.includes(it.state)) {
        it.state = 'failed'
        it.error = 'перервано: ' + reason
        changed = true
      }
    }
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    if (changed) this.flushPersist?.()
    this.running = false
    console.log('[autoreg] interrupt("' + reason + '"): in-flight → failed, queued лишається для resume')
  }

  resumeCaptcha(): void {
    this.registrar.resume()
  }

  /** Потоковий запуск: емітить 'progress' після кожної фази, 'done' в кінці. */
  async run(opts: AutoregOptions & { resume?: boolean }, win: BrowserWindow | null): Promise<AutoregItem[]> {
    if (this.running) throw new Error('Автореєстрація вже запущена')
    this.running = true
    this.cancelled = false
    this.currentIndex = -1

    const captchaProvider = opts.captchaProvider ?? 'manual'
    const delayMs = opts.delayMs ?? 2500 + Math.floor(Math.random() * 3000)
    // OTP через ПРЯМИЙ IMAP (REGER-механізм): кожен запит = свіже з'єднання +
    // серверний SEARCH по To-заголовку. Стійкий до «мовчазних» backend-ів Gmail.
    // Префлайт IMAP
    const preflight = await ImapClient.testConnection(opts.imapConfig)
    if (!preflight.ok) {
      this.running = false
      throw new Error(`IMAP не підключено: ${preflight.error || 'невідома помилка'}`)
    }

    // Резюм: якщо data/autoreg-state.json існує з тим самим доменом — пропускаємо вже done акаунти
    let resumeState: AutoregResumeState | null = null
    if (opts.resume) {
      const existing = readState(dataDir())
      if (existing && existing.catchAllDomain === opts.catchAllDomain) {
        const remain = resumableItems(existing)
        if (remain.length > 0 || existing.items.length >= opts.count) {
          console.log('[autoreg] resume: продовжуємо з ' + remain.length + ' залишку')
          this.items = existing.items.map((it) => ({
            id: crypto.randomUUID(),
            email: it.email,
            pass: it.pass,
            state: (it.phase === 'done' ? 'done' : 'queued') as AutoregState,
            key: it.key,
            error: it.error ?? undefined,
          }))
          resumeState = existing
        }
      }
    }

    // Якщо резюму немає (або домен інший) — ініціалізуємо з нуля
    if (!resumeState) {
      // 2.1.2: стиль email і людські імена з налаштувань
      const st = settingsSnapshot()
      const style: EmailStyle = st.emailStyle ?? 'random'
      const prefix = st.emailPrefix
      this.items = Array.from({ length: opts.count }, () => {
        const email = genEmail(opts.catchAllDomain, style, prefix)
        const pass = genPass()
        const name = genName()
        return { id: crypto.randomUUID(), email, pass, state: 'queued' as AutoregState, name }
      })
      writeState(dataDir(), emptyState(opts.catchAllDomain))
    }

    const emitProgress = (): void => {
      this.emit('progress', { items: [...this.items], current: this.currentIndex, total: this.items.length })
      // Персит state на диск після кожної зміни — щоб крах не втратив прогрес
      persistResume()
    }
    this.persistTimer = null
    this.flushPersist = (): void => {
      const items: AutoregResumeItem[] = this.items.map((it) => ({
        email: it.email,
        pass: it.pass,
        phase: (it.state === 'cancelled' ? 'queued' : it.state) as AutoregResumePhase,
        key: it.key,
        attempts: 0,
        error: it.error ?? null,
      }))
      try {
        writeState(dataDir(), {
          ...emptyState(opts.catchAllDomain),
          items,
        })
      } catch {
        /* resume best-effort — не ламаємо основний flow */
      }
    }
    const persistResume = (): void => {
      // Дебаунс: пишемо не частіше ніж раз на 500мс
      if (this.persistTimer) return
      this.persistTimer = setTimeout(() => {
        this.persistTimer = null
        this.flushPersist?.()
      }, 500)
    }

    // Проброс капчі назовні
    const onCaptcha = (payload: { email: string; message: string }): void => {
      if (captchaProvider === 'manual') {
        this.emit('captcha', payload)
      } else {
        // Для 2captcha/capsolver — поки що fallback на ручну (автосолвер — наступна ітерація)
        console.log(`[autoreg] captcha provider=${captchaProvider} — fallback to manual for ${payload.email}`)
        this.emit('captcha', { ...payload, message: `${payload.message} (провайдер ${captchaProvider} — поки ручний режим)` })
      }
    }
    this.registrar.on('captcha', onCaptcha)

    // Мультипотік: N воркерів тягнуть черговий queued-акаунт. Воркери ПЕРСИСТЕНТНІ:
    // після завершення задачі (успіх/фейл) + пауза delayMs беруть наступну —
    // на весь прогін працює рівно N одночасних реєстрацій.
    // Cap 25: понад це Clerk/Vercel починають 429-ти на всі запити одразу.
    const workers = Math.max(1, Math.min(25, Math.floor(opts.concurrency ?? 1)))
    if (workers > 1) console.log('[autoreg] concurrency=' + workers + ' потоків')
    // Proxy penalty: рушій може рапортувати фейли; BrowserSignup сам тримає лічильники,
    // тут лише пробросимо події вилучення в лог.
    const bs = this.registrar as import('./browserSignupRegistrar').BrowserSignupRegistrar
    let next = 0
    const workerLoop = async (workerId: number): Promise<void> => {
      // Stagger старту: 1.2 c між потоками — не бомбимо Vercel checkpoint пачкою
      if (workerId > 1) await new Promise((r) => setTimeout(r, (workerId - 1) * 1200))
      while (true) {
        if (this.cancelled) {
          let marked = false
          for (const it of this.items) {
            if (it.state === 'queued') { it.state = 'cancelled'; marked = true }
          }
          if (marked) emitProgress()
          return
        }
        const i = next++
        if (i >= this.items.length) return

        // Резюм: done-акаунти не реєструємо повторно
        if (this.items[i].state === 'done') {
          emitProgress()
          continue
        }

        this.currentIndex = i
        const item = this.items[i]
        item.state = 'form'
        emitProgress()

        let result: RegisterResult
        try {
          result = await this.registrar.registerOne(
            item.email,
            item.pass,
            undefined, // OTP прямим IMAP усередині registrar (imapDirectOtp)
            win,
            undefined,
            undefined,
            item.name
          )
        } catch (err) {
          result = {
            success: false,
            email: item.email,
            pass: item.pass,
            error: err instanceof Error ? err.message : String(err)
          }
        }

        // Proxy penalty: 2 фейли підряд на одному проксі → вилучення з ротації
        if (bs && typeof bs.reportProxySuccess === 'function') {
          const usedProxy: string | null = bs._lastProxy ?? null
          if (result.success) {
            bs.reportProxySuccess(usedProxy)
          } else {
            const removed = bs.reportProxyFailure(usedProxy)
            if (removed) {
              console.log('[autoreg] proxy видалено після 2 фейлів підряд:',
                usedProxy?.replace(/\/\/[^@]+@/, '//***@'))
            }
          }
        }

        if (result.success && result.key) {
          item.state = 'done'
          item.key = result.key
          appendKeyLine(result.key)
          try {
            await this.pool.addKeys([result.key], undefined, 'pool')
          } catch (e) {
            console.error(`[autoreg] addKeys failed for ${item.email}:`, e)
          }
        } else if (result.success && !result.key) {
          // Акаунт створено але ключ не знайдено — частковий успіх
          item.state = 'done'
          item.error = result.error || 'Ключ не знайдено — перевірте вручну'
        } else {
          item.state = 'failed'
          item.error = result.error || 'Невідома помилка'
        }

        appendAccountsLine(item.email, item.pass, result.key, result.error)
        this.emit('item-done', { item: { ...item }, index: i })
        emitProgress()

        // Пауза після акаунта, потік бере наступний (restart delay).
        if (next < this.items.length && !this.cancelled) {
          const pause = delayMs + Math.floor(Math.random() * 1000)
          await new Promise((r) => setTimeout(r, pause))
        }
      }
    }
    try {
      await Promise.all(
        Array.from({ length: Math.min(workers, this.items.length) }, (_, k) => workerLoop(k + 1))
      )

      // ── Рятувальний прохід: 'done без ключа' → відновити сесію → повторний /keys ──
      const keyless = this.items.filter((it) => it.state === 'done' && !it.key)
      const rescuer = this.registrar as import('./browserSignupRegistrar').BrowserSignupRegistrar
      if (keyless.length > 0 && typeof rescuer.rescueKey === 'function' && !this.cancelled) {
        console.log(`[autoreg] rescue: ${keyless.length} акаунтів без ключа — повторна спроба через збережені сесії`)
        this.emit('progress', { items: [...this.items], current: this.currentIndex, total: this.items.length })
        const rescueSem = Math.min(5, keyless.length)
        let ri = 0
        const rescueWorker = async (): Promise<void> => {
          while (true) {
            const i = ri++
            if (i >= keyless.length || this.cancelled) return
            const it = keyless[i]
            try {
              const key = await rescuer.rescueKey(it.email)
              if (key) {
                it.key = key
                it.error = undefined
                appendKeyLine(key)
                try { await this.pool.addKeys([key], undefined, 'pool') } catch { /* ignore */ }
                console.log(`[autoreg] rescue OK ${it.email} → ${key.slice(0, 16)}…`)
                this.emit('item-done', { item: { ...it }, index: -1 })
                this.emit('progress', { items: [...this.items], current: this.currentIndex, total: this.items.length })
              }
            } catch { /* rescue best-effort */ }
            await new Promise((r) => setTimeout(r, 1500))
          }
        }
        await Promise.all(Array.from({ length: rescueSem }, () => rescueWorker()))
      }
    } finally {
      if (this.persistTimer) { clearTimeout(this.persistTimer); this.persistTimer = null }
      // Фінальний синхронний запис: стан на диску навіть якщо процес вийде
      // одразу після 'done'
      this.flushPersist?.()
      this.flushPersist = null
      this.registrar.off('captcha', onCaptcha)
      try { await this.registrar.close() } catch {}
      // Якщо всі акаунти done — підчищаємо state (наступного разу йдемо з нуля).
      // Інакше лишаємо файл — користувач зможе resume=true продовжити.
      const allDone = this.items.length > 0 && this.items.every((it) => it.state === 'done')
      if (allDone) {
        try { clearState(dataDir()) } catch {}
      }
      this.running = false
      this.emit('done', { items: [...this.items] })
    }

    return [...this.items]
  }
}
