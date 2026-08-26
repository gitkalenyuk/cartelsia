import { EventEmitter } from 'events'
import { appendFileSync } from 'fs'
import { join } from 'path'
import { BrowserWindow } from 'electron'
import { ImapClient } from './imapClient'
import { ImapOtpPoller } from './imapOtpPoller'
import type { RegisterResult } from './playwrightRegistrar'
import type { CheckVerificationResult } from './imapClient'
import type { KeyPool } from '../keys/keyPool'
import type { ImapConfig, CaptchaProvider } from '../../shared/types'
import { dataDir, outputDir } from '../paths'
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

function randStr(len: number, alphabet: string): string {
  let s = ''
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)]
  return s
}

function genEmail(domain: string): string {
  const time = Date.now().toString(36)
  const rnd = randStr(4, 'abcdefghijklmnopqrstuvwxyz0123456789')
  return `cartelia_${time}_${rnd}@${domain}`
}

function genPass(): string {
  const upper = randStr(5, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')
  const digits = randStr(2, '0123456789')
  const lower = randStr(2, 'abcdefghijklmnopqrstuvwxyz')
  return `Cartelia_${upper}${digits}${lower}!9`
}

function appendAccountsLine(email: string, pass: string, key?: string, err?: string): void {
  const line = `${new Date().toISOString().slice(0, 19).replace('T', ' ')} | Email: ${email} | Pass: ${pass} | Key: ${key || 'no-key'} | ${err || 'ok'}\n`
  try { appendFileSync(join(dataDir(), 'accounts.txt'), line, 'utf8') } catch {}
  try { appendFileSync(join(outputDir(), 'accounts.txt'), line, 'utf8') } catch {}
}

/** Публічний інтерфейс рушія реєстрації (PlaywrightRegistrar і BrowserlessRegistrar структурно сумісні). */
export interface RegistrarEngine {
  registerOne(
    email: string,
    pass: string,
    checkEmailFn: () => Promise<CheckVerificationResult>,
    win: BrowserWindow | null,
    timeoutMs?: number,
    captchaTimeoutMs?: number
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
    // Спільний IMAP OTP-полер: одне з'єднання на всі потоки (Gmail чутливий до скупчення LOGIN)
    const poller = new ImapOtpPoller(opts.imapConfig)

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
      this.items = Array.from({ length: opts.count }, () => {
        const email = genEmail(opts.catchAllDomain)
        const pass = genPass()
        return { id: crypto.randomUUID(), email, pass, state: 'queued' as AutoregState }
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

    // Мультипотік: N воркерів тягнуть черговий queued-акаунт (concurrency=1 — те саме, що раніш серійно).
    const workers = Math.max(1, Math.min(20, Math.floor(opts.concurrency ?? 1)))
    if (workers > 1) console.log('[autoreg] concurrency=' + workers + ' потоків')
    let next = 0
    const workerLoop = async (): Promise<void> => {
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
            () => poller.waitForVerification(item.email),
            win
          )
        } catch (err) {
          result = {
            success: false,
            email: item.email,
            pass: item.pass,
            error: err instanceof Error ? err.message : String(err)
          }
        }

        if (result.success && result.key) {
          item.state = 'done'
          item.key = result.key
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

        // Пауза після акаунта (якщо залишилось і не скасовано) — розтягує старти потоків
        if (next < this.items.length && !this.cancelled) {
          const pause = delayMs + Math.floor(Math.random() * 1000)
          console.log(`[autoreg] пауза ${pause}мс (потік #${i + 1})`)
          await new Promise((r) => setTimeout(r, pause))
        }
      }
    }
    try {
      await Promise.all(
        Array.from({ length: Math.min(workers, this.items.length) }, () => workerLoop())
      )
    } finally {
      poller.close()
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
