import { mkdtempSync, rmSync, existsSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── мок fetch ────────────────────────────────────────────────

interface Call {
  url: string
  method?: string
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
  const call = { url, method: init?.method }
  calls.push(call)
  if (!handler) throw new Error('no handler')
  return handler(call)
}

const UUID_A = 'afe1bd4e-954e-48cc-8225-22c0aaaaaaa1'
const UUID_B = 'afe1bd4e-954e-48cc-8225-22c0aaaaaaa2'

/** Публічний голос у відповідях API */
const PUBLIC_VOICE = {
  id: UUID_A,
  name: 'Don Pedro',
  language: 'uk',
  is_owner: false,
  access: { type: 'public', visibility: 'all' }
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'shared-voices-test-'))
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

async function makeRegistry(readerKey = () => 'sk_test') {
  vi.resetModules()
  const { CartesiaClient } = await import('../src/main/cartesia/client')
  const { SharedVoiceRegistry } = await import('../src/main/voices/sharedVoiceRegistry')
  const client = new CartesiaClient(fetchMock as unknown as typeof fetch)
  return new SharedVoiceRegistry(dir, client, readerKey)
}

describe('SharedVoiceRegistry — add', () => {
  it('успішно додає публічний голос з фактом is_owner=false', async () => {
    handler = (c) => {
      if (/\/voices\/[0-9a-f-]+$/.test(c.url)) return res(200, PUBLIC_VOICE)
      return res(404, {})
    }
    const reg = await makeRegistry()
    const out = await reg.add(UUID_A, 'don-pedro')
    expect(out.error).toBeUndefined()
    expect(out.entry).toMatchObject({
      alias: 'don-pedro',
      voiceId: UUID_A.toLowerCase(),
      remoteName: 'Don Pedro',
      language: 'uk',
      isOwner: false,
      access: 'public',
      status: 'ok'
    })
    // запис на диск
    expect(existsSync(join(dir, 'shared_voices.json'))).toBe(true)
  })

  it('відхиляє ПРИВАТНИЙ чужий голос без збереження', async () => {
    handler = (c) =>
      res(200, { ...PUBLIC_VOICE, access: { type: 'private' } })
    const reg = await makeRegistry()
    const out = await reg.add(UUID_A, 'steal')
    expect(out.error).toContain('приватн')
    expect(out.entry).toBeUndefined()
    expect(existsSync(join(dir, 'shared_voices.json'))).toBe(false) // нічого не писано
  })

  it('404 → чітке повідомлення про приватність/невірний ID', async () => {
    handler = () => res(404, { error_code: 'not_found' })
    const reg = await makeRegistry()
    const out = await reg.add(UUID_A, 'ghost')
    expect(out.error).toContain('не знайдено')
  })

  it('401 → повідомлення про ключ/доступ', async () => {
    handler = () => res(401, { error_code: 'auth' })
    const reg = await makeRegistry()
    const out = await reg.add(UUID_A, 'nope')
    expect(out.error).toContain('Ключ відхилено')
  })

  it('валідація: поганий alias / поганий UUID / дублікати', async () => {
    handler = () => res(200, PUBLIC_VOICE)
    const reg = await makeRegistry()

    expect((await reg.add(UUID_A, 'Bad Alias!')).error).toContain('Аліас')
    expect((await reg.add('неuuid', 'ok-alias')).error).toContain('voice ID')

    expect((await reg.add(UUID_A, 'dup')).error).toBeUndefined() // перший ок
    expect((await reg.add(UUID_A, 'dup')).error).toContain('уже зайнятий') // той самий alias
    expect((await reg.add(UUID_A, 'dup2')).error).toContain('вже в реєстрі') // той самий id
  })

  it('переживає рестарт (persist/load)', async () => {
    handler = () => res(200, PUBLIC_VOICE)
    const reg1 = await makeRegistry()
    await reg1.add(UUID_A, 'restart-test')
    // новий інстанс над тим самим dir
    const reg2 = await makeRegistry()
    expect(reg2.get('restart-test')?.remoteName).toBe('Don Pedro')
  })
})

describe('SharedVoiceRegistry — check / ревокація', () => {
  async function seedWith(status: 'public-then-private' | 'ok') {
    const reg = await makeRegistry()
    handler = () => res(200, PUBLIC_VOICE)
    await reg.add(UUID_A, 'vola')
    return reg
  }

  it('check фіксує ревокацію коли власник зробив voice private', async () => {
    const reg = await seedWith('ok')
    handler = () => res(200, { ...PUBLIC_VOICE, access: { type: 'private' } })
    const results = await reg.check()
    expect(results[0].status).toBe('revoked')
    expect(reg.get('vola')?.status).toBe('revoked')
  })

  it('check оновлює last_verified і лишає ok коли все добре', async () => {
    const reg = await seedWith('ok')
    handler = () => res(200, PUBLIC_VOICE)
    const before = reg.get('vola')!.lastVerified
    await new Promise((r) => setTimeout(r, 10))
    const results = await reg.check()
    expect(results[0].status).toBe('ok')
    expect(reg.get('vola')!.lastVerified).not.toBe(before)
  })

  it('verifyForChat повертає revoked → scheduler має абортити (не мовчазно підміняти)', async () => {
    const reg = await seedWith('ok')
    handler = () => res(200, { ...PUBLIC_VOICE, access: { type: 'private' } })
    const { revoked } = await reg.verifyForChat(['vola'])
    expect(revoked).toHaveLength(1)
    expect(revoked[0].alias).toBe('vola')
  })

  it('verifyForChat ПЕРЕВІРЯЄ мережу навіть для свіжого ok (ревокація могла статись щойно)', async () => {
    const reg = await seedWith('ok')
    const callsBefore = calls.length
    const { revoked } = await reg.verifyForChat(['vola'])
    expect(revoked).toHaveLength(0)
    expect(calls.length).toBe(callsBefore + 1) // рівно один GET /voices/{id}
  })

  it('remove видаляє лише локальний запис — API не викликається', async () => {
    const reg = await seedWith('ok')
    const callsBefore = calls.length
    expect(reg.remove('vola')).toBe(true)
    expect(calls.length).toBe(callsBefore)
    expect(reg.get('vola')).toBeUndefined()
    expect(reg.remove('vola')).toBe(false)
  })
})

// ── TtsCache ────────────────────────────────────────────────

describe('TtsCache', () => {
  async function makeCache() {
    vi.resetModules()
    const { TtsCache } = await import('../src/main/tts/ttsCache')
    return new TtsCache(join(dir, 'cache'))
  }

  function wavBytes(seconds: number): Buffer {
    const pcm = Buffer.alloc(Math.floor(44100 * seconds) * 2)
    const header = Buffer.alloc(44)
    header.write('RIFF', 0)
    header.writeUInt32LE(36 + pcm.length, 4)
    header.writeUInt32LE(pcm.length, 40)
    return Buffer.concat([header, pcm])
  }

  it('miss → put → hit; різний текст = різний ключ', async () => {
    const cache = await makeCache()
    expect(cache.get('v1', 'sonic-3.5', 'uk', 'Привіт')).toBeUndefined()
    cache.put('v1', 'sonic-3.5', 'uk', 'Привіт', wavBytes(1))
    expect(cache.get('v1', 'sonic-3.5', 'uk', 'Привіт')).toBeDefined()
    expect(cache.get('v1', 'sonic-3.5', 'uk', 'Інший текст')).toBeUndefined()
    expect(cache.get('v2', 'sonic-3.5', 'uk', 'Привіт')).toBeUndefined()
  })

  it('атомарний запис не лишає обріаних файлів при імітації крашу (tmp відрізняється)', async () => {
    const cache = await makeCache()
    cache.put('v1', 'm', undefined, 'x', wavBytes(2))
    // ш долка шукати tmp-сміття в shard-директорії
    const shard = join(dir, 'cache')
    const listAll = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? listAll(join(d, e.name)) : [join(d, e.name)]
      )
    const files = listAll(shard)
    expect(files.some((f) => f.endsWith('.wav'))).toBe(true)
    expect(files.some((f) => f.includes('.tmp'))).toBe(false)
  })

  it('short-cache-key шардування: два різні ключі лягають у файли', async () => {
    const cache = await makeCache()
    cache.put('va', 'm', 'uk', 'текст A', wavBytes(1))
    cache.put('vb', 'm', 'uk', 'текст B', wavBytes(1))
    expect(cache.get('va', 'm', 'uk', 'текст A')).toBeDefined()
    expect(cache.get('vb', 'm', 'uk', 'текст B')).toBeDefined()
  })
})
