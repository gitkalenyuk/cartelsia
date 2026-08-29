import { describe, expect, it } from 'vitest'

/**
 * 2.1.1: sonic-3.6 + locale.
 * Перевіряємо КОНТРАКТ запиту: locale взаємовиключний з language (живо підтверджено:
 * обидва разом → 400 "language and locale are mutually exclusive").
 */

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

async function makeClient() {
  const { CartesiaClient } = await import('../src/main/cartesia/client')
  const bodies: Array<Record<string, unknown>> = []
  const fetchMock = async (_url: string, init?: RequestInit): Promise<Response> => {
    bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
    return res(200, { audio: 'aGVsbG8=' })
  }
  // tts/bytes повертає бінарний контент — для ttsBytes достатньо будь-якого тіла
  const fetchBinary = async (_url: string, init?: RequestInit): Promise<Response> => {
    bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array([1, 0, 1, 0]).buffer
    } as unknown as Response
  }
  const client = new CartesiaClient(fetchBinary as unknown as typeof fetch)
  return { client, bodies }
}

const BASE = {
  voiceId: 'v-uuid',
  output: { container: 'wav' as const, sampleRate: 44100 as const },
  chunkSize: 500,
  subtitleMode: false,
  silenceMs: 300,
  autoMerge: false
}

describe('locale vs language взаємовиключність (2.1.1)', () => {
  it('locale перемагає: тіло містить locale, БЕЗ language', async () => {
    const { client, bodies } = await makeClient()
    await client.ttsBytes('sk', 'текст', {
      ...BASE,
      modelId: 'sonic-3.6',
      language: 'uk',
      locale: 'uk-UA'
    })
    expect(bodies[0].locale).toBe('uk-UA')
    expect(bodies[0].language).toBeUndefined()
  })

  it('без locale → language як раніше', async () => {
    const { client, bodies } = await makeClient()
    await client.ttsBytes('sk', 'текст', { ...BASE, modelId: 'sonic-3.6', language: 'uk' })
    expect(bodies[0].language).toBe('uk')
    expect(bodies[0].locale).toBeUndefined()
  })

  it('locale без language → тільки locale', async () => {
    const { client, bodies } = await makeClient()
    await client.ttsBytes('sk', 'текст', { ...BASE, modelId: 'sonic-3.6', locale: 'en-GB' })
    expect(bodies[0].locale).toBe('en-GB')
    expect(bodies[0].language).toBeUndefined()
  })

  it('sonic-3.6 у ModelId валідний (типізований дефолт оновлено)', async () => {
    const { DEFAULT_GENERATION_SETTINGS } = await import('../src/shared/types')
    expect(DEFAULT_GENERATION_SETTINGS.modelId).toBe('sonic-3.6')
  })

  it('старі чати з sonic-3.5 залишаються валідними (back-compat union)', async () => {
    const { DEFAULT_GENERATION_SETTINGS } = await import('../src/shared/types')
    // TS-union тепер містить усі три моделі — sonic-3.5 не зламується
    const old: import('../src/shared/types').ModelId = 'sonic-3.5'
    expect(old).not.toBe(DEFAULT_GENERATION_SETTINGS.modelId)
  })
})
