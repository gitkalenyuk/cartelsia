import { describe, expect, it } from 'vitest'
import { KeyPool } from '../src/main/keys/keyPool'
import { Scheduler } from '../src/main/tts/scheduler'
import { CartesiaError } from '../src/main/cartesia/errors'
import type { CartesiaClient } from '../src/main/cartesia/client'
import { makeChat, mockChatStore, mockClient, mockLedger, tempDir, waitFor } from './helpers'

const K1 = 'sk_car_AAAAAAAAAAAAAAAAAAAA01'
const K2 = 'sk_car_BBBBBBBBBBBBBBBBBBBB02'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function setup(opts: {
  keys: string[]
  client: CartesiaClient
}): Promise<{ pool: KeyPool; scheduler: Scheduler }> {
  const pool = new KeyPool(tempDir(), opts.client, mockLedger())
  await pool.addKeys(opts.keys)
  const scheduler = new Scheduler(pool, opts.client, mockChatStore())
  return { pool, scheduler }
}

describe('Scheduler', () => {
  it('генерує всі чанки і завершує чергу', async () => {
    const client = mockClient()
    const { scheduler } = await setup({ keys: [K1, K2], client })
    const chat = makeChat(['один.', 'два.', 'три.', 'чотири.'])
    let finished: { ok: number; failed: number } | null = null
    scheduler.on('event', (e) => {
      if (e.type === 'queue-finished') finished = { ok: e.ok, failed: e.failed }
    })
    scheduler.start(chat)
    await waitFor(() => finished !== null)
    expect(finished).toEqual({ ok: 4, failed: 0 })
    expect(chat.chunks.every((c) => c.status === 'done')).toBe(true)
    expect(chat.chunks.every((c) => c.versions.length === 1)).toBe(true)
  })

  it('не перевищує 2 одночасні запити на ключ', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const client = mockClient({
      ttsBytes: async () => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await sleep(30)
        inFlight--
        return { audio: Buffer.from('mp3'), format: 'mp3' as const, sampleRate: 44100 }
      }
    })
    const { scheduler } = await setup({ keys: [K1], client })
    const chat = makeChat(['а.', 'б.', 'в.', 'г.', 'д.', 'е.'])
    let done = false
    scheduler.on('event', (e) => {
      if (e.type === 'queue-finished') done = true
    })
    scheduler.start(chat)
    await waitFor(() => done)
    expect(maxInFlight).toBeLessThanOrEqual(2)
  })

  it('quota_exceeded: морозить ключ і передає чанк іншому', async () => {
    const usedKeys: string[] = []
    const client = mockClient({
      ttsBytes: async (key: string) => {
        usedKeys.push(key)
        if (key === K1) {
          throw new CartesiaError('quota_exceeded', 'account has exceeded quota', {
            errorCode: 'quota_exceeded'
          })
        }
        return { audio: Buffer.from('mp3'), format: 'mp3' as const, sampleRate: 44100 }
      }
    })
    const { pool, scheduler } = await setup({ keys: [K1, K2], client })
    // best-fit обере K1 першим (однакові remaining, менше слотів) — форсуємо K1 меншим remaining
    const [a] = pool.listPublic()
    pool.update(a.id, { usedChars: 10 })

    const chat = makeChat(['тест один.'])
    let finished = false
    scheduler.on('event', (e) => {
      if (e.type === 'queue-finished') finished = true
    })
    scheduler.start(chat)
    await waitFor(() => finished)

    expect(chat.chunks[0].status).toBe('done')
    const k1After = pool.listPublic().find((k) => k.id === a.id)!
    expect(k1After.status).toBe('frozen')
    expect(k1After.freezeReason).toBe('quota_exceeded')
    expect(k1After.remaining).toBe(0)
    // помилка не витратила спробу — чанк успішний
    expect(chat.chunks[0].attempts).toBe(0)
  })

  it('мережеві помилки: 3 спроби з ротацією ключів → failed', async () => {
    const triedKeys = new Set<string>()
    const client = mockClient({
      ttsBytes: async (key: string) => {
        triedKeys.add(key)
        throw new CartesiaError('server', 'HTTP 500')
      }
    })
    const { scheduler } = await setup({ keys: [K1, K2], client })
    const chat = makeChat(['впаде.'])
    let finished = false
    scheduler.on('event', (e) => {
      if (e.type === 'queue-finished') finished = true
    })
    scheduler.start(chat)
    await waitFor(() => finished)
    expect(chat.chunks[0].status).toBe('failed')
    expect(chat.chunks[0].attempts).toBe(3)
    expect(triedKeys.size).toBe(2) // ротація торкнулась обох ключів
    expect(chat.chunks[0].lastError?.message).toContain('500')
  })

  it('bin-packing: чанк, що не влазить у малий залишок, іде на інший ключ; малий чанк добиває малий ключ', async () => {
    const usage = new Map<string, number>()
    const client = mockClient({
      ttsBytes: async (key: string, text: string) => {
        usage.set(key, (usage.get(key) ?? 0) + text.length)
        return { audio: Buffer.from('mp3'), format: 'mp3' as const, sampleRate: 44100 }
      }
    })
    const { pool, scheduler } = await setup({ keys: [K1, K2], client })
    const [a] = pool.listPublic()
    pool.update(a.id, { usedChars: 19_700 }) // A: залишок 300

    const big = 'б'.repeat(500) + '.'
    const small = 'м'.repeat(150) + '.'
    const chat = makeChat([big, small])
    let finished = false
    scheduler.on('event', (e) => {
      if (e.type === 'queue-finished') finished = true
    })
    scheduler.start(chat)
    await waitFor(() => finished)

    expect(chat.chunks.every((c) => c.status === 'done')).toBe(true)
    // великий чанк пішов на K2, малий — на K1 (best-fit добиває малий залишок)
    expect(usage.get(K2)).toBe(big.length)
    expect(usage.get(K1)).toBe(small.length)
  })

  it('всі ключі не вміщують → waiting-key і scheduler-paused', async () => {
    const client = mockClient()
    const { pool, scheduler } = await setup({ keys: [K1], client })
    const key = pool.listPublic()[0]
    pool.freeze(key.id, 'quota_exceeded')

    const chat = makeChat(['потрібно більше золота.'])
    let paused: string | null = null
    scheduler.on('event', (e) => {
      if (e.type === 'scheduler-paused') paused = e.reason
    })
    scheduler.start(chat)
    await waitFor(() => paused !== null)
    expect(chat.chunks[0].status).toBe('waiting-key')
    expect(paused).toBe('all-frozen')
  })

  it('розморозка ключа автоматично відновлює чергу', async () => {
    let nowValue = new Date('2026-07-16T12:00:00Z')
    const client = mockClient()
    const pool = new KeyPool(tempDir(), client, mockLedger(), () => nowValue)
    await pool.addKeys([K1])
    const scheduler = new Scheduler(pool, client, mockChatStore())
    pool.freeze(pool.listPublic()[0].id, 'quota_exceeded')

    const chat = makeChat(['зачекаю на ключ.'])
    let finished = false
    scheduler.on('event', (e) => {
      if (e.type === 'queue-finished') finished = true
    })
    scheduler.start(chat)
    await sleep(50)
    expect(chat.chunks[0].status).toBe('waiting-key')

    // місяць минув
    nowValue = new Date('2026-08-16T12:00:01Z')
    pool.tick()
    await waitFor(() => finished)
    expect(chat.chunks[0].status).toBe('done')
  })

  it('клон-голос пришпилений до ключа-власника', async () => {
    const usedKeys = new Set<string>()
    const client = mockClient({
      ttsBytes: async (key: string) => {
        usedKeys.add(key)
        await sleep(5)
        return { audio: Buffer.from('mp3'), format: 'mp3' as const, sampleRate: 44100 }
      }
    })
    const { pool, scheduler } = await setup({ keys: [K1, K2], client })
    const keyB = pool.listPublic()[1]

    const chat = makeChat(['раз.', 'два.', 'три.', 'чотири.'], {
      voiceOwningKeyId: keyB.id
    })
    let finished = false
    scheduler.on('event', (e) => {
      if (e.type === 'queue-finished') finished = true
    })
    scheduler.start(chat)
    await waitFor(() => finished)
    expect(usedKeys.size).toBe(1)
    expect(usedKeys.has(K2)).toBe(true)
  })

  it('retryChunk скидає лічильники і переганяє чанк', async () => {
    let fail = true
    const client = mockClient({
      ttsBytes: async () => {
        if (fail) throw new CartesiaError('server', 'HTTP 503')
        return { audio: Buffer.from('mp3'), format: 'mp3' as const, sampleRate: 44100 }
      }
    })
    const { scheduler } = await setup({ keys: [K1], client })
    const chat = makeChat(['спершу впаде.'])
    let finishes = 0
    scheduler.on('event', (e) => {
      if (e.type === 'queue-finished') finishes++
    })
    scheduler.start(chat)
    await waitFor(() => finishes === 1)
    expect(chat.chunks[0].status).toBe('failed')

    fail = false
    scheduler.retryChunk(chat.id, chat.chunks[0].id)
    await waitFor(() => finishes === 2)
    expect(chat.chunks[0].status).toBe('done')
  })
})
