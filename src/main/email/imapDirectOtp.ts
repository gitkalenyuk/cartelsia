/**
 * Прямий IMAP OTP-пошук — порт з REGER (перевірено наживо, серпень 2026).
 *
 * Чому НЕ старий ImapOtpPoller: довгоживуче з'єднання потрапляє на «мовчазний»
 * backend Gmail і гниє (SEARCH повертає порожньо назавжди). Тут кожен запит —
 * СВІЖЕ TLS+LOGIN з'єднання (новий backend щоразу) + серверний пошук по
 * заголовку To: `SEARCH HEADER To "<email>"` (~2 c, тільки наші листи).
 *
 * Знайдений лист одразу DELETE+EXPUNGE — повторний poll не схопить старий код,
 * і паралельні потоки не заберуть чужий (пошук строго по своїй To-адресі).
 */
import tls from 'tls'
import { extractVerification } from './otpParser'

export interface DirectImapConfig {
  host: string
  port: number
  user: string
  pass: string
}

interface DirectSession {
  exec: (cmd: string, timeoutMs?: number) => Promise<string>
  close: () => void
}

const OPEN_ATTEMPTS = 3

function openSession(cfg: DirectImapConfig): Promise<DirectSession> {
  const once = (): Promise<DirectSession> =>
    new Promise((resolve, reject) => {
      const socket = tls.connect(
        { host: cfg.host, port: cfg.port || 993, rejectUnauthorized: false, servername: cfg.host },
        () => {
          let buf = ''
          let pending: { predicate: (b: string) => boolean; resolve: (v: string) => void; reject: (e: Error) => void; timer: NodeJS.Timeout } | null = null

          const trySettle = (): void => {
            if (!pending) return
            if (pending.predicate(buf)) {
              const out = buf
              buf = ''
              const p = pending
              pending = null
              clearTimeout(p.timer)
              p.resolve(out)
            }
          }

          socket.on('data', (d: Buffer) => {
            buf += d.toString('utf8')
            trySettle()
          })
          socket.on('error', (e: Error) => {
            if (pending) { clearTimeout(pending.timer); pending.reject(e); pending = null }
          })

          const exec = (tagged: string, timeoutMs = 20_000): Promise<string> => {
            const tag = tagged.split(' ')[0]
            return new Promise<string>((resolve, reject) => {
              buf = ''
              pending = {
                predicate: (b) =>
                  b.split('\r\n').some((l) => l.startsWith(`${tag} OK`) || l.startsWith(`${tag} NO`) || l.startsWith(`${tag} BAD`)),
                resolve: resolve as (v: string) => void,
                reject,
                timer: setTimeout(() => { pending = null; reject(new Error(`IMAP timeout: ${tagged.slice(0, 40)}`)) }, timeoutMs)
              }
              socket.write(tagged + '\r\n')
            }).then((raw: string) => {
              const bad = raw.split('\r\n').find((l) => l.startsWith(tag + ' NO') || l.startsWith(tag + ' BAD'))
              if (bad) throw new Error(`IMAP error: ${bad}`)
              return raw
            })
          }

          // greeting: * OK ...
          const waitGreeting = setTimeout(() => { pending = null; reject(new Error('IMAP greeting timeout')) }, 15_000)
          pending = {
            predicate: (b) => b.includes('* OK'),
            resolve: () => {
              clearTimeout(waitGreeting)
              const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
              exec(`A0 LOGIN "${esc(cfg.user)}" "${esc(cfg.pass)}"`)
                .then(() => exec('A1 SELECT INBOX'))
                .then(() => resolve({ exec, close: () => socket.destroy() }))
                .catch(reject)
            },
            reject: (e) => { clearTimeout(waitGreeting); reject(e) },
            timer: waitGreeting
          }
        }
      )
      socket.setTimeout(25_000, () => { socket.destroy(); reject(new Error('IMAP socket timeout')) })
      socket.on('error', reject)
    })

  const go = async (attempt: number): Promise<DirectSession> => {
    try {
      return await once()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const retryable = /timeout|hang up|ECONNRESET|EPIPE/i.test(msg)
      if (retryable && attempt < OPEN_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 300 * attempt))
        return go(attempt + 1)
      }
      throw e
    }
  }
  return go(1)
}

/** Витягує UID-и з * SEARCH відповіді. */
function parseUids(res: string): string[] {
  const line = res.split('\r\n').find((l) => l.startsWith('* SEARCH'))
  if (!line) {
    const m = res.match(/\* SEARCH\s+([0-9\s]+)/)
    return m ? m[1].trim().split(/\s+/).filter(Boolean) : []
  }
  return line.slice(8).trim().split(/\s+/).filter(Boolean)
}

/**
 * Один прохід: знайти найновіший OTP-лист для target та повернути код.
 * null = поки немає. Кидає тільки при фатальних помилках логіна.
 */
export async function fetchOtpOnce(cfg: DirectImapConfig, targetEmail: string): Promise<string | null> {
  const target = targetEmail.toLowerCase().trim()
  const s = await openSession(cfg)
  try {
    const res = await s.exec(`S1 UID SEARCH HEADER To "${target}"`, 25_000)
    const uids = parseUids(res)
    if (!uids.length) return null
    // від найновішого
    for (let i = uids.length - 1; i >= 0; i--) {
      const uid = uids[i]
      const raw = await s.exec(`F1 UID FETCH ${uid} (BODY.PEEK[])`, 25_000)
      const lower = raw.toLowerCase()
      // лише листи від Cartesia/Clerk
      if (!lower.includes('cartesia') && !lower.includes('clerk')) continue
      const v = extractVerification(raw)
      if (v.code) {
        // Прибираємо використаний лист — щоб повторний poll не дав той самий код
        try {
          await s.exec(`S2 UID STORE ${uid} +FLAGS (\\Deleted)`)
          await s.exec('S3 EXPUNGE')
        } catch { /* best effort */ }
        return v.code
      }
    }
    return null
  } finally {
    s.close()
  }
}

/**
 * Чекає OTP для email: опитує щополя POLL_MS новим з'єднанням.
 * Резолвиться кодом або null на таймауті.
 */
export async function waitForOtpDirect(
  cfg: DirectImapConfig,
  email: string,
  timeoutMs = 130_000,
  pollMs = 4_000
): Promise<string | null> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const code = await fetchOtpOnce(cfg, email)
      if (code) return code
    } catch (e) {
      // transient (мережа / мовчазний backend) — наступний прохід новим з'єднанням
      console.log('[imap-direct] poll error (retry):', e instanceof Error ? e.message.slice(0, 80) : String(e))
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  return null
}
