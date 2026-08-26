import tls from 'tls'
import type { ImapConfig } from '../../shared/types'
import { extractVerification, decodeBody } from './otpParser'

export interface CheckVerificationResult {
  found: boolean
  link?: string
  code?: string
  error?: string
}

// Re-export for back-compat: код, що раніше імпортував з imapClient, лишається робочим.
export { extractVerification, decodeBody } from './otpParser'

/** Дістає всі TO / Delivered-To / Envelope-To / X-Original-To адреси з IMAP-відповіді. */
export function extractAddrsFromHeaders(raw: string): string[] {
  const addrs: string[] = []
  const re = /(?:^|\r?\n)\s*(?:To|Delivered-To|Envelope-To|X-Original-To|X-Envelope-To|Return-Path):\s*([^\r\n]+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    const headerVal = m[1]
    const emailRe = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g
    let em: RegExpExecArray | null
    while ((em = emailRe.exec(headerVal))) addrs.push(em[0].toLowerCase())
  }
  return addrs
}

export class ImapClient {
  static async testConnection(config: ImapConfig): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.withSession(config, async (s) => {
        await s.exec('A1 SELECT INBOX')
      })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  static async findVerificationLink(
    config: ImapConfig,
    recipientEmail: string,
    sinceMs: number = Date.now() - 10 * 60 * 1000
  ): Promise<CheckVerificationResult> {
    return this.findVerificationLinkInternal(config, recipientEmail, sinceMs)
  }

  /** Аліас для code-first логіки — той самий пошук, але caller явно хоче код. */
  static async findVerificationCode(
    config: ImapConfig,
    recipientEmail: string,
    sinceMs: number = Date.now() - 10 * 60 * 1000
  ): Promise<CheckVerificationResult> {
    return this.findVerificationLinkInternal(config, recipientEmail, sinceMs)
  }

  private static async findVerificationLinkInternal(
    config: ImapConfig,
    recipientEmail: string,
    sinceMs: number
  ): Promise<CheckVerificationResult> {
    const targetLower = recipientEmail.toLowerCase()
    const inner = async (): Promise<{ link?: string; code?: string } | null> => {
      let found: { link?: string; code?: string } | null = null
      await this.withSession(config, async (s) => {
        await s.exec('A1 SELECT INBOX')

        const since = new Date(sinceMs)
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        const d = `${String(since.getDate()).padStart(2, '0')}-${months[since.getMonth()]}-${since.getFullYear()}`

        let uids: string[] = []
        try {
          const r1 = await s.exec(`A2 UID SEARCH SINCE ${d} FROM "cartesia.ai"`)
          uids = parseSearchUids(r1)
        } catch {
          /* ignore — fallback нижче */
        }
        if (!uids.length) {
          try {
            const r2 = await s.exec(`A3 UID SEARCH SINCE ${d}`)
            uids = parseSearchUids(r2)
          } catch {
            uids = []
          }
        }
        if (!uids.length) return

        const recent = uids.slice(-20).reverse()

        // === КРОК 1: СТРОГО по TO === recipientEmail ===
        // Скануємо останні 20, але приймаємо тільки листи де TO == recipientEmail
        let strictCandidates: { uid: string; body: string }[] = []
        for (const uid of recent) {
          const body = await s.exec(
            `A4 UID FETCH ${uid} (BODY[HEADER.FIELDS (SUBJECT TO FROM DATE DELIVERED-TO ENVELOPE-TO X-ORIGINAL-TO)] BODY[TEXT])`
          )
          const recipients = extractAddrsFromHeaders(body)
          const isExactMatch = recipients.includes(targetLower)
          if (!isExactMatch) continue
          // Додатково перевіряємо що це від Cartesia/WorkOS
          const lower = body.toLowerCase()
          const isFromCartesia =
            lower.includes('cartesia') || lower.includes('noreply') || lower.includes('workos')
          // Якщо TO збігається — навіть якщо FROM не cartesia, це наш лист (catch-all)
          // Але якщо є FROM cartesia — це точно наш
          strictCandidates.push({ uid, body })
          // Пріоритет: шукаємо код саме серед strict
          const res = extractVerification(body)
          if (res.code) {
            found = res
            return
          }
          if (res.link && !found) found = res
        }
        if (found && (found.code || found.link)) return

        // === КРОК 2: fallback — серед усіх останніх 20, але тільки якщо body містить recipientEmail ===
        // (на випадок якщо заголовок TO зберігся інакше, наприклад без кута < >)
        for (const uid of recent) {
          // Пропускаємо вже перевірені
          if (strictCandidates.some((c) => c.uid === uid)) continue
          const body = await s.exec(`A5 UID FETCH ${uid} (BODY[HEADER.FIELDS (SUBJECT TO FROM DATE)] BODY[TEXT])`)
          if (!body.toLowerCase().includes(targetLower)) continue
          const res = extractVerification(body)
          if (res.code) {
            found = res
            return
          }
          if (res.link && !found) found = res
        }
        if (found && (found.code || found.link)) return
      })
      return found
    }

    try {
      const found = await inner()
      if (found && (found.link || found.code)) {
        return { found: true, link: found.link, code: found.code }
      }
      return { found: false }
    } catch (err) {
      return { found: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  private static withSession<T>(config: ImapConfig, fn: (s: ImapSession) => Promise<T>): Promise<T> {
    return openImapSession(config).then(async (session) => {
      try {
        return await fn(session)
      } finally {
        session.close()
      }
    })
  }
}

/**
 * Преходні помилки (тихий backend, обрив соединения) — безпечно повторити
 * НОВИМ з'єднанням: Gmail "мовчить" на окремих backend-інстансах для нашого IP
 * (грітінг доходить, відповідь на будь-яку команду ковтають, навіть NOOP;
 * докази й метод: scripts/probe_noop_gated.ps1, scripts/probe_trace.ps1).
 * Нова TCP-конекція потрапляє в інший backend і відповідає за <1с.
 * Відмова авторизації (NO/BAD) — остаточний вердикт сервера, ретраїти марно.
 */
export function isImapRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /timeout/i.test(msg) || /socket hang up/i.test(msg) || /ECONNRESET/i.test(msg)
}

const OPEN_ATTEMPTS = 3
const OPEN_BACKOFF_MS = 300

/**
 * Відкриває довгоживучий IMAP-сесійний канал (TLS + LOGIN) — для спільного полера
 * (imapOtpPoller). Один виклик = одне з'єднання; закриває викликовий через session.close().
 *
 * Стійкість: до OPEN_ATTEMPTS спроб з новим з'єднанням при преходних помилках
 * (isImapRetryableError) з backoff OPEN_BACKOFF_MS × номер спроби.
 */
export function openImapSession(config: ImapConfig): Promise<ImapSession> {
  let attempt = 0
  const go = (): Promise<ImapSession> => {
    attempt += 1
    return openImapSessionOnce(config).catch((err): Promise<ImapSession> => {
      if (!isImapRetryableError(err) || attempt >= OPEN_ATTEMPTS) return Promise.reject(err)
      return new Promise<ImapSession>((r) => setTimeout(r, OPEN_BACKOFF_MS * attempt)).then(() => go())
    })
  }
  return go()
}

function openImapSessionOnce(config: ImapConfig): Promise<ImapSession> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host: config.host,
        port: config.port || 993,
        rejectUnauthorized: false,
        servername: config.host
      },
      async () => {
        const session = new ImapSession(socket)
        try {
          await session.readUntil((line) => line.startsWith('* OK'))
          // Екрануємо \ та " в credentials
          const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
          await session.exec(`A0 LOGIN "${esc(config.user)}" "${esc(config.pass)}"`)
          resolve(session)
        } catch (err) {
          session.close()
          reject(err)
        }
      }
    )
    socket.setTimeout(20_000, () => {
      socket.destroy()
      reject(new Error('IMAP socket timeout 20s'))
    })
    socket.on('error', (err) => reject(err))
  })
}

/** Витягує UID-и з `* SEARCH` відповіді IMAP — стійко до фрагментації TCP. */
export function parseSearchUids(response: string): string[] {
  const lines = response.split('\r\n')
  for (const line of lines) {
    if (line.startsWith('* SEARCH')) {
      return line
        .slice(8)
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .filter((v) => /^\d+$/.test(v))
    }
  }
  // fallback: regex якщо SEARCH і дані в одному чанку з тегом
  const match = response.match(/\* SEARCH\s+([0-9\s]+)/)
  if (match) {
    return match[1]
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .filter((v) => /^\d+$/.test(v))
  }
  return []
}

/**
 * Простий IMAP-парсер: чекає, поки в буфері не з'явиться рядок
 * "<tag> OK" / "<tag> BAD" / "<tag> NO", потім віддає весь буфер.
 */
export class ImapSession {
  private buffer = ''

  constructor(private socket: tls.TLSSocket, private timeoutMs: number = 15_000) {}

  /** Закрити сесію (socket destroy; Gmail нормально обрізання без LOGOUT). */
  close(): void {
    const s = this.socket
    try {
      s.setTimeout(0)
      s.removeAllListeners('data')
      s.destroy()
    } catch {
      /* ignore */
    }
  }

  private append(chunk: string): void {
    this.buffer += chunk
  }

  /**
   * exec(cmd) чекає на tag-рядок "<tag> OK/NO/BAD" і повертає весь буфер.
   *
   * Стійкість: при таймауті (тихий backend) команду пересилають ще РАЗ по
   * тому ж з'єднанню — усі команди, що тут використовуються (SELECT/SEARCH/
   * FETCH), ідемпотентні. Остаточні NO/BAD і обрив сокета ретраїв не мають.
   */
  exec(cmd: string): Promise<string> {
    const run = (retriesLeft: number): Promise<string> =>
      new Promise<string>((resolve, reject) => {
        const tag = cmd.split(' ')[0]
        const cleanup = (): void => {
          this.socket.off('data', onData)
          clearTimeout(timeout)
        }
        const onData = (data: Buffer): void => {
          this.append(data.toString('utf8'))
          const lines = this.buffer.split('\r\n')
          for (const line of lines) {
            if (line.startsWith(`${tag} OK`)) {
              const out = this.buffer
              this.buffer = ''
              cleanup()
              resolve(out)
              return
            }
            if (line.startsWith(`${tag} NO`) || line.startsWith(`${tag} BAD`)) {
              cleanup()
              reject(new Error(`IMAP ${tag}: ${line}`))
              return
            }
          }
        }
        this.socket.on('data', onData)
        const timeout = setTimeout(() => {
          cleanup()
          reject(new Error(`IMAP timeout ${cmd}`))
        }, this.timeoutMs)
        this.socket.write(`${cmd}\r\n`)
      }).catch((err) => {
        if (retriesLeft > 0 && isImapRetryableError(err) && !this.socket.destroyed) {
          return run(retriesLeft - 1)
        }
        throw err
      })
    return run(1)
  }

  /** Чекає першого рядка, що відповідає predicate. */
  readUntil(predicate: (line: string) => boolean): Promise<void> {
    return new Promise((resolve) => {
      const onData = (data: Buffer): void => {
        this.append(data.toString('utf8'))
        const lines = this.buffer.split('\r\n')
        for (const line of lines) {
          if (predicate(line)) {
            this.socket.off('data', onData)
            resolve()
            return
          }
        }
      }
      this.socket.on('data', onData)
    })
  }
}
