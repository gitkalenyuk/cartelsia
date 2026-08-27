/**
 * Спільний IMAP OTP-полер: ОДНЕ довгоживуче IMAP-з'єднання на всі потоки реєстрації.
 *
 * Чому: кожен findVerificationLink() відкривав власне TLS+LOGIN, і з N=10 потоків
 * Gmail отримував ~2 входи/с на один ящик і rate-limitив (OTP мовчав, потоки
 * гнили в "Форма..." до 180-с таймауту). Тут: одне з'єднання, один SEARCH+FETCH
 * цикл кожні 3 с, знайдені коди маршрутуються чекуючим потокам за TO-адресою.
 */
import type { ImapConfig } from '../../shared/types'
import type { CheckVerificationResult } from './imapClient'
import { ImapSession, openImapSession, extractAddrsFromHeaders, parseSearchUids } from './imapClient'
import { extractVerification } from './otpParser'

const POLL_INTERVAL_MS = 3_000
const MAX_UNSEEN_PER_CYCLE = 15

interface Waiter {
  email: string
  resolve: (r: CheckVerificationResult) => void
}

export class ImapOtpPoller {
  private session: ImapSession | null = null
  private connecting: Promise<ImapSession> | null = null
  private loopAlive = false
  private closed = false
  private waiters: Waiter[] = []
  private seen = new Set<string>()

  constructor(private config: ImapConfig) {}

  get waiterCount(): number {
    return this.waiters.length
  }

  /**
   * Чекати (не довше waitMs) верифікацію (code або link) для email.
   * found:false на таймауті — caller повторно опитує власним циклом.
   */
  waitForVerification(email: string, waitMs = 100_000): Promise<CheckVerificationResult> {
    return new Promise((resolve) => {
      const settled = { v: false }
      const done = (r: CheckVerificationResult): void => {
        if (settled.v) return
        settled.v = true
        clearTimeout(timer)
        resolve(r)
      }
      const timer = setTimeout(() => done({ found: false }), waitMs)
      this.waiters.push({ email: email.toLowerCase(), resolve: done })
      void this.ensureLoop()
    })
  }

  close(): void {
    this.closed = true
    if (this.session) {
      const s = this.session
      this.session = null
      s.close()
    }
    for (const w of this.waiters.splice(0)) {
      try { w.resolve({ found: false }) } catch { /* ignore */ }
    }
  }

  private ensureLoop(): void {
    if (this.loopAlive || this.closed) return
    this.loopAlive = true
    void this.loop()
  }

  private async loop(): Promise<void> {
    try {
      while (!this.closed) {
        if (this.waiters.length === 0) {
          // Ніхто не чекає — вільне з'єднання не тримаємо
          if (this.session) {
            const s = this.session
            this.session = null
            s.close()
          }
          await sleep(POLL_INTERVAL_MS)
          continue
        }
        await sleep(POLL_INTERVAL_MS)
        try {
          await this.pollOnce()
        } catch (e) {
          console.error('[imap-poller] цикл упав:', e instanceof Error ? e.message : String(e))
          if (this.session) {
            this.session.close()
            this.session = null
          }
        }
      }
    } finally {
      this.loopAlive = false
    }
  }

  private async getSession(): Promise<ImapSession> {
    if (this.session) return this.session
    if (!this.connecting) {
      this.connecting = openImapSession(this.config).then(async (s) => {
        // Без SELECT INBOX пошук/фетч повертає помилку — коди ніколи не знаходяться.
        await s.exec('A1 SELECT INBOX')
        this.session = s
        this.connecting = null
        return s
      }).catch((e) => {
        this.connecting = null
        throw e
      })
    }
    return this.connecting
  }

  private async pollOnce(): Promise<void> {
    const s = await this.getSession()
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const since = new Date(Date.now() - 10 * 60 * 1000)
    const d = `${String(since.getDate()).padStart(2, '0')}-${months[since.getMonth()]}-${since.getFullYear()}`
    let uids: string[] = []
    try {
      uids = parseSearchUids(await s.exec(`P1 UID SEARCH SINCE ${d} FROM "cartesia.ai"`))
    } catch {
      /* fallback нижче */
    }
    if (!uids.length) {
      try {
        uids = parseSearchUids(await s.exec(`P2 UID SEARCH SINCE ${d}`))
      } catch {
        uids = []
      }
    }
    if (!uids.length) return
    const recent = uids.slice(-20).reverse()
    let budget = MAX_UNSEEN_PER_CYCLE
    for (const uid of recent) {
      if (budget-- <= 0) break
      if (this.seen.has(uid)) continue
      let body: string
      try {
        body = await s.exec(
          `P3 UID FETCH ${uid} (BODY[HEADER.FIELDS (SUBJECT TO FROM DATE DELIVERED-TO X-ENVELOPE-TO X-ORIGINAL-TO)] BODY[TEXT])`
        )
      } catch (e) {
        console.error('[imap-poller] FETCH упав (uid ' + uid + '):', e instanceof Error ? e.message : String(e))
        continue
      }
      this.seen.add(uid)
      const recipients = extractAddrsFromHeaders(body)
      if (!recipients.length) continue
      const res = extractVerification(body)
      if (!res.code && !res.link) continue
      // Найстаріший чекаючий серед получальників
      let idx = -1
      for (let i = 0; i < this.waiters.length; i++) {
        if (recipients.includes(this.waiters[i].email)) {
          idx = i
          break
        }
      }
      if (idx < 0) {
        console.log('[imap-poller] верифікація (code=' + !!res.code + ') для ' + recipients[0].slice(0, 24) + ' — ще немає чекаючого')
        continue
      }
      const w = this.waiters.splice(idx, 1)[0]
      console.log('[imap-poller] ' + (res.code ? 'OTP code' : 'link') + ' → ' + w.email)
      w.resolve({ found: true, code: res.code, link: res.link })
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
