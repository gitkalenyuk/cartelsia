import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImapSession, isImapRetryableError, openImapSession } from '../../src/main/email/imapClient'
import type { ImapConfig } from '../../src/shared/types'

// ---------- fake socket ----------

interface FakeSocket {
  socket: import('tls').TLSSocket
  written: string[]
  destroyed: boolean
  emit: (s: string) => void
}

function makeFakeSocket(): FakeSocket {
  const handlers: Record<string, ((d: Buffer) => void)[]> = {}
  const fake = {
    destroyed: false,
    written: [] as string[],
    setTimeout: vi.fn(),
    on(ev: string, cb: (d: Buffer) => void) {
      (handlers[ev] ??= []).push(cb)
      return fake
    },
    off(ev: string, cb: (d: Buffer) => void) {
      handlers[ev] = (handlers[ev] ?? []).filter((f) => f !== cb)
      return fake
    },
    write(data: string | Buffer): boolean {
      fake.written.push(String(data))
      return true
    },
    removeAllListeners() {
      for (const k of Object.keys(handlers)) handlers[k] = []
    },
    destroy() {
      fake.destroyed = true
    }
  }
  return {
    socket: fake as unknown as import('tls').TLSSocket,
    written: fake.written,
    destroyed: false,
    emit: (s: string) => handlers.data?.forEach((cb) => cb(Buffer.from(s)))
  }
}

const CFG: ImapConfig = { host: 'imap.gmail.com', port: 993, user: 'u@gmail.com', pass: 'p', tls: true }

// ---------- isImapRetryableError ----------

describe('isImapRetryableError', () => {
  it('таймаути (exec і socket) — ретраєблемі', () => {
    expect(isImapRetryableError(new Error('IMAP timeout A0 LOGIN "u" "p"'))).toBe(true)
    expect(isImapRetryableError(new Error('IMAP socket timeout 20s'))).toBe(true)
  })
  it('обриви соединения — ретраєблемі', () => {
    expect(isImapRetryableError(new Error('socket hang up'))).toBe(true)
    expect(isImapRetryableError(new Error('read ECONNRESET'))).toBe(true)
  })
  it('остаточна відмова авторизації — НЕ ретраєблема', () => {
    expect(isImapRetryableError(new Error('IMAP A0: A0 NO [AUTH] Username and password not accepted'))).toBe(false)
    expect(isImapRetryableError(new Error('IMAP A1: A1 BAD ...'))).toBe(false)
  })
  it('DNS/інші помилки — НЕ ретраєблемі (швидко і марно)', () => {
    expect(isImapRetryableError(new Error('getaddrinfo ENOTFOUND imap.gmail.com'))).toBe(false)
  })
})

// ---------- ImapSession.exec: retry ----------

describe('ImapSession.exec', () => {
  it('таймаут тихого backendу → пересилає команду ще раз → OK', async () => {
    const fake = makeFakeSocket()
    const session = new ImapSession(fake.socket, 30)
    const p = session.exec('A1 SELECT INBOX')
    // перша відправка "заглушена" (даних немає), druga — відповідає
    setTimeout(() => fake.emit('A1 OK [READ-ONLY] Completed\r\n'), 50)
    const out = await p
    expect(fake.written).toEqual(['A1 SELECT INBOX\r\n', 'A1 SELECT INBOX\r\n'])
    expect(out).toContain('A1 OK [READ-ONLY] Completed')
  })

  it('два таймаути поспіль → reject, команда відправлена рівно двічі', async () => {
    const fake = makeFakeSocket()
    const session = new ImapSession(fake.socket, 20)
    await expect(session.exec('A1 SELECT INBOX')).rejects.toThrow('IMAP timeout A1 SELECT INBOX')
    expect(fake.written.length).toBe(2)
  })

  it('остаточна NO — одразу reject, БЕЗ ресайлу', async () => {
    const fake = makeFakeSocket()
    const session = new ImapSession(fake.socket, 50)
    const p = session.exec('A1 SELECT INBOX')
    setTimeout(() => fake.emit('A1 NO [ALERT] Internal error\r\n'), 5)
    await expect(p).rejects.toThrow(/^IMAP A1: A1 NO/)
    expect(fake.written.length).toBe(1)
  })

  it('обриваний сокет (destroyed) — ресайл не запускається', async () => {
    const fake = makeFakeSocket()
    const session = new ImapSession(fake.socket, 20)
    const p = session.exec('A1 SELECT INBOX')
    setTimeout(() => (fake.socket as unknown as { destroyed: boolean }).destroyed = true, 10)
    await expect(p).rejects.toThrow('IMAP timeout A1 SELECT INBOX')
    expect(fake.written.length).toBe(1)
  })
})

// ---------- openImapSession: retry на тихий backend ----------

const { connectMock } = vi.hoisted(() => ({ connectMock: vi.fn() }))
vi.mock('tls', () => ({ default: { connect: connectMock } }))

/**
 * Мока tls.connect: повертає faке-сокет, синхронно кличе onConnect ('secureConnect'),
 * через 0 мс посилає грітінг. Поведінка на LOGIN — згідно з mode:
 *  - 'silent' : грітінг приходить, LOGIN-команди ковтає (ніколи не відповідає)
 *  - 'ok'     : на LOGIN відповідає OK
 *  - 'no'     : на LOGIN відповідає NO
 */
function mockConnectSequence(modes: Array<'silent' | 'ok' | 'no'>): FakeSocket[] {
  const opened: FakeSocket[] = []
  let i = 0
  connectMock.mockImplementation((_opts: unknown, onConnect: () => void) => {
    const mode = modes[Math.min(i, modes.length - 1)]
    i++
    const handlers: Record<string, ((d: Buffer) => void)[]> = {}
    const fake = {
      destroyed: false,
      setTimeout: vi.fn(),
      on(ev: string, cb: (d: Buffer) => void) {
        (handlers[ev] ??= []).push(cb)
        return fake
      },
      off(ev: string, cb: (d: Buffer) => void) {
        handlers[ev] = (handlers[ev] ?? []).filter((f) => f !== cb)
        return fake
      },
      write(data: string | Buffer): boolean {
        const s = String(data)
        if (mode === 'ok' && s.includes('LOGIN')) {
          handlers.data?.forEach((cb) => cb(Buffer.from('* CAPABILITY X-GM-EXT-1\r\nA0 OK u@gmail.com authenticated (Success)\r\n')))
        }
        if (mode === 'no' && s.includes('LOGIN')) {
          handlers.data?.forEach((cb) => cb(Buffer.from('A0 NO [AUTH] Username and password not accepted.\r\n')))
        }
        return true
      },
      removeAllListeners() {
        for (const k of Object.keys(handlers)) handlers[k] = []
      },
      destroy() {
        fake.destroyed = true
      }
    }
    const entry: FakeSocket = {
      socket: fake as unknown as import('tls').TLSSocket,
      written: [],
      destroyed: false,
      emit: (s: string) => handlers.data?.forEach((cb) => cb(Buffer.from(s)))
    }
    // write() реєструємо в жернал entry
    const origWrite = fake.write
    fake.write = (d: string | Buffer): boolean => {
      entry.written.push(String(d))
      return origWrite(d)
    }
    opened.push(entry)
    // наслідок 'secureConnect' — наступний 0-таймер (після ініціалізації socket у коді)
    setTimeout(onConnect, 0)
    // грітінг — ще наступніший (вже після підписки readUntil)
    setTimeout(() => entry.emit('* OK Gimap ready for requests\r\n'), 0)
    return entry.socket
  })
  return opened
}

describe('openImapSession — стійкість до тихого backendу', () => {
  afterEach(() => {
    vi.useRealTimers()
    connectMock.mockReset()
  })

  it('тихий backend на LOGIN → перепідєднання новим з\'єднанням → success (2 конекції)', async () => {
    vi.useFakeTimers()
    const opened = mockConnectSequence(['silent', 'ok'])
    const p = openImapSession(CFG)
    // грітінг #1 + LOGIN (#1) пишеться (два 0-таймери + мікрозадачі)
    await vi.advanceTimersByTimeAsync(2)
    expect(opened[0].written.some((w) => w.includes('LOGIN'))).toBe(true)
    // exec спроба 1 (15с) → ресайл, спроба 2 (15с) → openOnce reject → backoff 300мс → конекція #2
    await vi.advanceTimersByTimeAsync(15_000)
    await vi.advanceTimersByTimeAsync(15_000 + 400)
    const session = await p
    expect(connectMock).toHaveBeenCalledTimes(2)
    expect(opened.length).toBe(2)
    expect(session).toBeInstanceOf(ImapSession)
  })

  it('остаточна NO авторизації — БЕЗ перепідєднання (1 конекція)', async () => {
    vi.useFakeTimers()
    mockConnectSequence(['no'])
    const p = openImapSession(CFG)
    const settled = expect(p).rejects.toThrow(/A0 NO/)
    await vi.advanceTimersByTimeAsync(10)
    await settled
    expect(connectMock).toHaveBeenCalledTimes(1)
  })

  it('3 тихі backendи поспіль → reject після 3 конекцій', async () => {
    vi.useFakeTimers()
    mockConnectSequence(['silent', 'silent', 'silent'])
    const p = openImapSession(CFG)
    const settled = expect(p).rejects.toThrow(/timeout/i)
    // кожен openOnce: 2×15с (exec спроба+ресайл) + backoff (300, 600)
    await vi.advanceTimersByTimeAsync(30_000 + 300)
    await vi.advanceTimersByTimeAsync(30_000 + 600)
    await vi.advanceTimersByTimeAsync(30_000 + 500)
    await settled
    expect(connectMock).toHaveBeenCalledTimes(3)
  })
})
