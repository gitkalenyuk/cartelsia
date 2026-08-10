import tls from 'tls'
import type { ImapConfig } from '../../shared/types'

export interface CheckVerificationResult {
  found: boolean
  link?: string
  code?: string
  error?: string
}

/** Quoted-Printable -> plain text (обробляє =XX, =\r\n, =3D). */
function decodeQuotedPrintable(input: string): string {
  return input
    .replace(/=\r?\n/g, '')
    .replace(/=3D/gi, '=')
    .replace(/=([A-Fa-f0-9]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
}

/** Спроба base64-декоду якщо тіло схоже на base64. */
function tryBase64Decode(input: string): string | null {
  // base64: тільки A-Za-z0-9+/= та переноси, довжина %4==0, мінімум 32 символи
  const stripped = input.replace(/\s+/g, '')
  if (stripped.length < 32 || stripped.length % 4 !== 0) return null
  if (!/^[A-Za-z0-9+/=]+$/.test(stripped)) return null
  try {
    const decoded = Buffer.from(stripped, 'base64').toString('utf8')
    // евристика: декодоване повинно містити читабельний текст / HTML
    if (decoded.includes('<') || decoded.includes('cartesia') || decoded.includes('verification') || /\d{6}/.test(decoded)) {
      return decoded
    }
    return null
  } catch {
    return null
  }
}

/** Декодує тіло листа з урахуванням Content-Transfer-Encoding. */
export function decodeBody(raw: string, encodingHint?: string): string {
  let out = raw
  const hint = (encodingHint || '').toLowerCase()
  const isBase64 = hint.includes('base64') || (!hint && tryBase64Decode(raw) !== null)

  if (isBase64) {
    const b64 = tryBase64Decode(raw)
    if (b64) return b64
    // fallback: спробувати декодувати навіть якщо евристика не спрацювала
    try {
      const maybe = Buffer.from(raw.replace(/\s+/g, ''), 'base64').toString('utf8')
      if (maybe.length > 20) out = maybe
    } catch {
      /* ignore */
    }
  }

  // quoted-printable завжди пробуємо (безпечно для plain text)
  out = decodeQuotedPrintable(out)
  return out
}

/** Витягує OTP-код та/або лінк з тіла листа. Пріоритет: code > link. */
export function extractVerification(rawBody: string): { code?: string; link?: string } {
  // Визначаємо encoding з заголовків якщо вони в rawBody
  const cteMatch = rawBody.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i)
  const encodingHint = cteMatch ? cteMatch[1].trim() : undefined

  // Витягуємо BODY[TEXT] частину якщо є IMAP-обгортка
  // Якщо rawBody містить IMAP FETCH обгортку, беремо все після заголовків BODY[TEXT]
  let bodyText = rawBody
  // Евристика: якщо є подвійний CRLF після заголовків — це тіло
  const headerEnd = rawBody.indexOf('\r\n\r\n')
  if (headerEnd !== -1 && rawBody.includes('BODY[TEXT]')) {
    // не обрізаємо агресивно — просто декодуємо все, парсер знайде код/лінк і так
  }

  const decoded = decodeBody(bodyText, encodingHint)
  const out: { code?: string; link?: string } = {}

  // 1) OTP код — пріоритет
  const boldMatch = decoded.match(/<b[^>]*>\s*(\d{6})\s*<\/b>/i)
  if (boldMatch) {
    out.code = boldMatch[1]
  } else {
    const phraseMatch = decoded.match(/verification\s+code[:\s]+(\d{6})/i)
    if (phraseMatch) out.code = phraseMatch[1]
    else {
      // fallback: 6 цифр поруч із "code" або "OTP"
      const looseMatch = decoded.match(/(?:code|otp)[^0-9]{0,20}(\d{6})/i)
      if (looseMatch) out.code = looseMatch[1]
    }
  }

  // 2) Лінк — тільки якщо містить cartesia/workos/verify (ігноруємо трекінг-пікселі)
  const urlMatches = decoded.match(/https?:\/\/[^\s"'<>]+/gi) ?? []
  for (const u of urlMatches) {
    const clean = u.replace(/&amp;/gi, '&').replace(/=3D/gi, '=').trim().replace(/[.,;]+$/, '')
    const lower = clean.toLowerCase()
    if (
      lower.includes('cartesia') ||
      lower.includes('workos') ||
      lower.includes('verify') ||
      lower.includes('confirm') ||
      lower.includes('callback')
    ) {
      // відфільтровуємо трекінг/ансабскрайб якщо немає verify/cartesia
      if (lower.includes('unsubscribe') && !lower.includes('cartesia') && !lower.includes('verify')) continue
      out.link = clean
      break
    }
  }

  return out
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
    const extractRecipientFromHeaders = (raw: string): string[] => {
      // Дістаємо всі TO / Delivered-To / Envelope-To / X-Original-To адреси з IMAP-відповіді
      const addrs: string[] = []
      const re = /(?:^|\r?\n)\s*(?:To|Delivered-To|Envelope-To|X-Original-To|X-Envelope-To|Return-Path):\s*([^\r\n]+)/gi
      let m: RegExpExecArray | null
      while ((m = re.exec(raw))) {
        // Витягуємо email з "Name <email>" або просто "email"
        const headerVal = m[1]
        const emailRe = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g
        let em: RegExpExecArray | null
        while ((em = emailRe.exec(headerVal))) addrs.push(em[0].toLowerCase())
      }
      return addrs
    }

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
          const recipients = extractRecipientFromHeaders(body)
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
            const res = await fn(session)
            try {
              await session.exec('A99 LOGOUT')
            } catch {
              /* ignore */
            }
            socket.end()
            resolve(res)
          } catch (err) {
            socket.destroy()
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
class ImapSession {
  private buffer = ''

  constructor(private socket: tls.TLSSocket) {}

  private append(chunk: string): void {
    this.buffer += chunk
  }

  /** exec(cmd) чекає на tag-рядок "<tag> OK/NO/BAD" і повертає весь буфер. */
  exec(cmd: string): Promise<string> {
    const tag = cmd.split(' ')[0]
    return new Promise((resolve, reject) => {
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
      }, 15_000)
      this.socket.write(`${cmd}\r\n`)
    })
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
