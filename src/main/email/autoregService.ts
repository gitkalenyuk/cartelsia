import { EventEmitter } from 'events'
import { appendFileSync } from 'fs'
import { join } from 'path'
import { BrowserWindow } from 'electron'
import { ImapClient } from './imapClient'
import type { PlaywrightRegistrar, RegisterResult } from './playwrightRegistrar'
import type { KeyPool } from '../keys/keyPool'
import type { ImapConfig, CaptchaProvider } from '../../shared/types'
import { dataDir, outputDir } from '../paths'

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

export class AutoregService extends EventEmitter {
  private items: AutoregItem[] = []
  private running = false
  private cancelled = false
  private currentIndex = -1

  constructor(
    private registrar: PlaywrightRegistrar,
    private pool: KeyPool
  ) {
    super()
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

  resumeCaptcha(): void {
    this.registrar.resume()
  }

  /** Потоковий запуск: емітить 'progress' після кожної фази, 'done' в кінці. */
  async run(opts: AutoregOptions, win: BrowserWindow | null): Promise<AutoregItem[]> {
    if (this.running) throw new Error('Автореєстрація вже запущена')
    this.running = true
    this.cancelled = false
    this.currentIndex = -1

    const captchaProvider = opts.captchaProvider ?? 'manual'
    const delayMs = opts.delayMs ?? 2500 + Math.floor(Math.random() * 3000)

    // Префлайт IMAP
    const preflight = await ImapClient.testConnection(opts.imapConfig)
    if (!preflight.ok) {
      this.running = false
      throw new Error(`IMAP не підключено: ${preflight.error || 'невідома помилка'}`)
    }

    // Ініціалізуємо items
    this.items = Array.from({ length: opts.count }, () => {
      const email = genEmail(opts.catchAllDomain)
      const pass = genPass()
      return { id: crypto.randomUUID(), email, pass, state: 'queued' as AutoregState }
    })

    const emitProgress = (): void => {
      this.emit('progress', { items: [...this.items], current: this.currentIndex, total: this.items.length })
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

    try {
      for (let i = 0; i < this.items.length; i++) {
        if (this.cancelled) {
          for (let j = i; j < this.items.length; j++) {
            if (this.items[j].state === 'queued') this.items[j].state = 'cancelled'
          }
          emitProgress()
          break
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
            () => ImapClient.findVerificationLink(opts.imapConfig, item.email, Date.now() - 60_000),
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

        // Пауза між акаунтами (крім останнього)
        if (i < this.items.length - 1 && !this.cancelled) {
          const pause = delayMs + Math.floor(Math.random() * 1000)
          console.log(`[autoreg] пауза ${pause}мс перед наступним акаунтом`)
          await new Promise((r) => setTimeout(r, pause))
        }
      }
    } finally {
      this.registrar.off('captcha', onCaptcha)
      try { await this.registrar.close() } catch {}
      this.running = false
      this.emit('done', { items: [...this.items] })
    }

    return [...this.items]
  }
}
