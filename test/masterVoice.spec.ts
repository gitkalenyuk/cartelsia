import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

// ── мок fetch ────────────────────────────────────────────────

interface Call {
  url: string
  method?: string
  headers: Record<string, string>
}

function res(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok: status < 400,
    status,
    text: async () => text,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    headers: new Headers(),
    arrayBuffer: async () => new ArrayBuffer(0)
  } as unknown as Response
}

let calls: Call[] = []
let handler: ((c: Call) => Response) | null = null

const fetchMock = async (url: string, init?: RequestInit): Promise<Response> => {
  const call: Call = {
    url,
    method: init?.method,
    headers: (init?.headers ?? {}) as Record<string, string>
  }
  calls.push(call)
  if (!handler) throw new Error('mock handler not set')
  return handler(call)
}

const settings = () => ({
  defaults: {} as never,
  notifySystem: true,
  notifySound: true,
  masterApiKey: 'sk_master_test',
  masterAutoPublic: true,
  masterConcurrency: 3
})

async function makeService(opts?: { autoPublic?: boolean }) {
  vi.resetModules()
  const { CartesiaClient } = await import('../src/main/cartesia/client')
  const { MasterVoiceService } = await import('../src/main/voices/masterVoiceService')
  const client = new CartesiaClient(fetchMock as unknown as typeof fetch)
  const s = { ...settings(), masterAutoPublic: opts?.autoPublic ?? true }
  const svc = new MasterVoiceService(dir, client, () => s)
  return svc
}

function toBuf(ab: ArrayBuffer): Buffer {
  return Buffer.from(ab)
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'master-voice-test-'))
  calls = []
  handler = null
})

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

describe('withRetry', () => {
  it('повторює 429 і зрештою успішно', async () => {
    const { withRetry } = await import('../src/main/cartesia/retry')
    let attempts = 0
    const out = await withRetry(
      async () => {
        attempts++
        if (attempts < 3) {
          const err = new Error('rate') as never as { kind: string }
          ;(err as unknown as { kind: string }).kind = 'concurrency_limited'
          throw Object.assign(new Error('rate'), { kind: 'concurrency_limited', name: 'CartesiaError' })
        }
        return 'ok'
      },
      { baseDelayMs: 1 }
    )
    expect(out).toBe('ok')
    expect(attempts).toBe(3)
  })

  it('НЕ повторює bad_request', async () => {
    const { withRetry } = await import('../src/main/cartesia/retry')
    let attempts = 0
    await expect(
      withRetry(
        async () => {
          attempts++
          throw Object.assign(new Error('bad'), { name: 'CartesiaError', kind: 'bad_request' })
        },
        { baseDelayMs: 1 }
      )
    ).rejects.toThrow('bad')
    expect(attempts).toBe(1)
  })

  it('обмежує кількість спроб', async () => {
    const { withRetry } = await import('../src/main/cartesia/retry')
    let attempts = 0
    await expect(
      withRetry(
        async () => {
          attempts++
          throw Object.assign(new Error('srv'), { name: 'CartesiaError', kind: 'server' })
        },
        { baseDelayMs: 1, maxAttempts: 3 }
      )
    ).rejects.toThrow()
    expect(attempts).toBe(3)
  })
})

describe('MasterVoiceService — статус', () => {
  it('configured=false коли ключа немає', async () => {
    vi.resetModules()
    const { CartesiaClient } = await import('../src/main/cartesia/client')
    const { MasterVoiceService } = await import('../src/main/voices/masterVoiceService')
    const client = new CartesiaClient(fetchMock as unknown as typeof fetch)
    const svc = new MasterVoiceService(dir, client, () => ({ ...settings(), masterApiKey: undefined }))
    const st = await svc.status()
    expect(st.configured).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('валідний ключ → valid=true', async () => {
    handler = (c) => {
      if (c.url.includes('/access-token')) return res(200, { value: 'jwt' })
      return res(404, {})
    }
    const svc = await makeService()
    const st = await svc.status()
    expect(st.valid).toBe(true)
  })
})

describe('MasterVoiceService — дедуплікація', () => {
  // аудіо у форматі WAV — препроцесор прожене через ffmpeg; у тестах ffmpeg є у PATH,
  // тому генеруємо справжній кліп через тишу → простіше: мінімальний валідний WAV 44.1к mono s16 2 c.
  function wavBytes(seconds: number): ArrayBuffer {
    const sampleRate = 8000
    const n = Math.floor(sampleRate * seconds)
    const pcm = Buffer.alloc(n * 2)
    for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 10) * 10000), i * 2)
    const header = Buffer.alloc(44)
    header.write('RIFF', 0)
    header.writeUInt32LE(36 + pcm.length, 4)
    header.write('WAVE', 8)
    header.write('fmt ', 12)
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20)
    header.writeUInt16LE(1, 22)
    header.writeUInt32LE(sampleRate, 24)
    header.writeUInt32LE(sampleRate * 2, 28)
    header.writeUInt16LE(2, 32)
    header.writeUInt16LE(16, 34)
    header.write('data', 36)
    header.writeUInt32LE(pcm.length, 40)
    return Buffer.concat([header, pcm]).buffer as ArrayBuffer
  }

  let cloneCount = 0

  beforeEach(() => {
    cloneCount = 0
  })

  it('другий виклик із тим самим аудіо НЕ клонує повторно', async () => {
    handler = (c) => {
      if (c.url.endsWith('/voices/clone')) {
        cloneCount++
        return res(200, {
          id: `voice-${cloneCount}`,
          name: 'Test Voice',
          language: 'uk',
          is_owner: true,
          access: { type: 'private' }
        })
      }
      if (c.url.includes('/voices/') && c.method === 'PATCH') {
        return res(200, { id: 'x', name: 'x', language: 'uk', access: { type: 'public' } })
      }
      if (/\/voices\/voice-\d+$/.test(c.url)) {
        return res(200, {
          id: c.url.split('/').pop(),
          name: 'Test Voice',
          language: 'uk',
          is_owner: true,
          access: { type: 'public' }
        })
      }
      return res(404, {})
    }

    const svc = await makeService()
    const clip = wavBytes(3)

    const first = await svc.clone({ clip: toBuf(clip), mimeType: 'audio/wav', name: 'V', language: 'uk' })
    expect(first.reused).toBe(false)
    expect(cloneCount).toBe(1)

    const second = await svc.clone({ clip: toBuf(clip), mimeType: 'audio/wav', name: 'V', language: 'uk' })
    expect(second.reused).toBe(true)
    expect(cloneCount).toBe(1) // другий clone-запит НЕ відбувся
    expect(second.voice.id).toBe(first.voice.id)
  }, 30_000)
})
