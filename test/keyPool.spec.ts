import { describe, expect, it } from 'vitest'
import { KeyPool, addOneMonth, maskKey } from '../src/main/keys/keyPool'
import { mockClient, mockLedger, tempDir } from './helpers'

const K1 = 'sk_car_AAAAAAAAAAAAAAAAAAAA01'
const K2 = 'sk_car_BBBBBBBBBBBBBBBBBBBB02'
const K3 = 'sk_car_CCCCCCCCCCCCCCCCCCCC03'

function makePool(now?: () => Date): KeyPool {
  return new KeyPool(tempDir(), mockClient(), mockLedger(), now)
}

describe('addOneMonth', () => {
  it('додає рівно місяць', () => {
    const d = addOneMonth(new Date('2026-07-16T14:30:00Z'))
    expect(d.toISOString()).toBe('2026-08-16T14:30:00.000Z')
  })
  it('31 січня → 28 лютого (не переливається в березень)', () => {
    const d = addOneMonth(new Date('2026-01-31T10:00:00Z'))
    expect(d.getUTCMonth()).toBe(1) // лютий
    expect(d.getUTCDate()).toBe(28)
  })
})

describe('maskKey', () => {
  it('маскує середину', () => {
    expect(maskKey('sk_car_1234567890abcd')).toBe('sk_car_…abcd')
  })
})

describe('KeyPool', () => {
  it('додає валідні ключі, відхиляє дублі та сміття', async () => {
    const pool = makePool()
    const res = await pool.addKeys([K1, K2, K1, 'not-a-key', ''])
    expect(res.added).toHaveLength(2)
    expect(res.rejected).toEqual([
      { key: maskKey(K1), reason: 'duplicate' },
      { key: 'not-a-key', reason: 'format' }
    ])
    expect(pool.activeCount()).toBe(2)
  })

  it('невалідний ключ (auth) отримує статус invalid', async () => {
    const pool = new KeyPool(
      tempDir(),
      mockClient({ validateKey: async () => false }),
      mockLedger()
    )
    const res = await pool.addKeys([K1])
    expect(res.added[0].status).toBe('invalid')
    expect(pool.activeCount()).toBe(0)
  })

  it('recordUsage веде лічильник і морозить при remaining < 100', async () => {
    const pool = makePool()
    await pool.addKeys([K1])
    const key = pool.listPublic()[0]
    pool.recordUsage(key.id, 19_800)
    expect(pool.listPublic()[0].status).toBe('active')
    pool.recordUsage(key.id, 150) // залишок 50 < 100
    const after = pool.listPublic()[0]
    expect(after.status).toBe('frozen')
    expect(after.freezeReason).toBe('low-remaining')
    expect(after.frozenUntil).toBeTruthy()
  })

  it('freeze(quota_exceeded) підтягує usedChars до ліміту', async () => {
    const pool = makePool()
    await pool.addKeys([K1])
    const key = pool.listPublic()[0]
    pool.recordUsage(key.id, 5000)
    pool.freeze(key.id, 'quota_exceeded')
    const after = pool.listPublic()[0]
    expect(after.status).toBe('frozen')
    expect(after.usedChars).toBe(after.limit)
    expect(after.remaining).toBe(0)
  })

  it('заморозка рівно +1 місяць і розморозка по tick', async () => {
    let nowValue = new Date('2026-07-16T12:00:00Z')
    const pool = makePool(() => nowValue)
    await pool.addKeys([K1])
    const key = pool.listPublic()[0]
    pool.freeze(key.id, 'low-remaining')
    const frozen = pool.listPublic()[0]
    expect(new Date(frozen.frozenUntil!).toISOString()).toBe('2026-08-16T12:00:00.000Z')

    // за день до розморозки — нічого
    nowValue = new Date('2026-08-15T12:00:00Z')
    pool.tick()
    expect(pool.listPublic()[0].status).toBe('frozen')

    // після дати — активний, лічильник скинуто
    nowValue = new Date('2026-08-16T12:00:01Z')
    pool.tick()
    const unfrozen = pool.listPublic()[0]
    expect(unfrozen.status).toBe('active')
    expect(unfrozen.usedChars).toBe(0)
  })

  it('candidatesFor: best-fit (найменший remaining, що вміщує), скіп замалих', async () => {
    const pool = makePool()
    await pool.addKeys([K1, K2, K3])
    const [a, b, c] = pool.listPublic()
    pool.update(a.id, { usedChars: 19_700 }) // remaining 300
    pool.update(b.id, { usedChars: 15_000 }) // remaining 5000
    pool.update(c.id, { usedChars: 10_000 }) // remaining 10000

    // чанк 500: A (300) не кандидат, найкращий — B (5000)
    const cands = pool.candidatesFor(500)
    expect(cands.map((k) => k.id)).toEqual([b.id, c.id])

    // чанк 200: A вміщує і має найменший remaining → перший
    const small = pool.candidatesFor(200)
    expect(small[0].id).toBe(a.id)
  })

  it('candidatesFor: pinned для клон-голосу', async () => {
    const pool = makePool()
    await pool.addKeys([K1, K2])
    const [a, b] = pool.listPublic()
    expect(pool.candidatesFor(100, b.id).map((k) => k.id)).toEqual([b.id])
    expect(pool.candidatesFor(100, a.id).map((k) => k.id)).toEqual([a.id])
  })

  it('семафор: максимум 2 слоти на ключ', async () => {
    const pool = makePool()
    await pool.addKeys([K1])
    const key = pool.listPublic()[0]
    expect(pool.acquireSlot(key.id)).toBe(true)
    expect(pool.acquireSlot(key.id)).toBe(true)
    expect(pool.acquireSlot(key.id)).toBe(false)
    expect(pool.candidatesFor(10)).toHaveLength(0) // слотів немає
    pool.releaseSlot(key.id)
    expect(pool.candidatesFor(10)).toHaveLength(1)
  })

  it('anyKeyCouldEver: заморожений ключ рахується (ліміт скинеться)', async () => {
    const pool = makePool()
    await pool.addKeys([K1])
    const key = pool.listPublic()[0]
    pool.freeze(key.id, 'quota_exceeded')
    expect(pool.anyKeyCouldEver(500)).toBe(true)
    expect(pool.anyKeyCouldEver(25_000)).toBe(false) // більше за ліміт узагалі
  })

  it('probe із quota-пробою розморожує ключ', async () => {
    const pool = makePool()
    await pool.addKeys([K1])
    const key = pool.listPublic()[0]
    pool.freeze(key.id, 'quota_exceeded')
    const res = await pool.probe(key.id, { run: async () => undefined })
    expect(res.authValid).toBe(true)
    expect(res.quotaOk).toBe(true)
    expect(res.key.status).toBe('active')
    expect(res.key.usedChars).toBe(1) // 1 символ проби
  })

  it('probe із невдалою пробою лишає замороженим', async () => {
    const pool = makePool()
    await pool.addKeys([K1])
    const key = pool.listPublic()[0]
    pool.freeze(key.id, 'quota_exceeded')
    const res = await pool.probe(key.id, {
      run: async () => {
        throw new Error('quota_exceeded')
      }
    })
    expect(res.quotaOk).toBe(false)
    expect(res.key.status).toBe('frozen')
  })
})
