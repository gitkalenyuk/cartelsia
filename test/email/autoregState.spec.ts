import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  AUTOREG_STATE_VERSION,
  emptyState,
  readState,
  resumableItems,
  statePath,
  summarize,
  writeState,
  clearState,
  type AutoregResumeState,
} from '../../src/main/email/autoregState'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cartelsia-state-'))
})

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

describe('statePath', () => {
  it('повертає шлях у вказаній директорії', () => {
    expect(statePath(dir)).toMatch(/autoreg-state\.json$/)
  })
})

describe('emptyState', () => {
  it('повертає коректну структуру', () => {
    const s = emptyState('kaleny.uk')
    expect(s.version).toBe(AUTOREG_STATE_VERSION)
    expect(s.catchAllDomain).toBe('kaleny.uk')
    expect(s.items).toEqual([])
    expect(s.startedAt).toBeTruthy()
    expect(s.updatedAt).toBeTruthy()
  })

  it('час старту й оновлення співпадають на старті', () => {
    const s = emptyState()
    expect(s.startedAt).toBe(s.updatedAt)
  })
})

describe('writeState + readState (roundtrip)', () => {
  it('зберігає й читає стан', () => {
    const s = emptyState('kaleny.uk')
    s.items.push({ email: 'a@x.io', pass: 'pw', phase: 'queued', attempts: 0 })
    writeState(dir, s)

    expect(existsSync(statePath(dir))).toBe(true)
    const read = readState(dir)
    expect(read).not.toBeNull()
    expect(read?.items).toHaveLength(1)
    expect(read?.items[0].email).toBe('a@x.io')
  })

  it('створює директорію якщо її немає', () => {
    const nested = join(dir, 'sub', 'dir')
    writeState(nested, emptyState('x.io'))
    expect(existsSync(statePath(nested))).toBe(true)
  })

  it('атомарний rename: файл завжди консистентний', () => {
    // writeState має прибирати .tmp — після двох послідовних writeState жодних .tmp не має лишитися
    writeState(dir, emptyState('a.io'))
    writeState(dir, emptyState('b.io'))
    const path = statePath(dir)
    expect(existsSync(path + '.tmp')).toBe(false)
    expect(readState(dir)?.catchAllDomain).toBe('b.io')
  })

  it('не пише .tmp після помилки запису (catch всередині)', () => {
    // Smoke test: writeState не кидає помилку на неіснуючий шлях (best-effort)
    expect(() => writeState('Z:\\nonexistent\\path\\here', emptyState('x.io'))).not.toThrow()
  })
})

describe('readState validation', () => {
  it('повертає null для невалідного JSON', () => {
    writeFileSync(statePath(dir), '{not-json', 'utf8')
    expect(readState(dir)).toBeNull()
  })

  it('повертає null для невідомої версії', () => {
    writeFileSync(statePath(dir), JSON.stringify({ version: 999, items: [] }), 'utf8')
    expect(readState(dir)).toBeNull()
  })

  it('повертає null якщо items не масив', () => {
    writeFileSync(statePath(dir), JSON.stringify({ version: AUTOREG_STATE_VERSION, items: 'oops' }), 'utf8')
    expect(readState(dir)).toBeNull()
  })

  it('повертає null якщо файлу немає', () => {
    expect(readState(dir)).toBeNull()
  })
})

describe('resumableItems', () => {
  it('пропускає done акаунти', () => {
    const s: AutoregResumeState = {
      ...emptyState('x.io'),
      items: [
        { email: 'a@x.io', pass: 'pw', phase: 'done', attempts: 1, key: 'sk_car_…' },
        { email: 'b@x.io', pass: 'pw', phase: 'verifying', attempts: 2 },
        { email: 'c@x.io', pass: 'pw', phase: 'failed', attempts: 3, error: 'captcha' },
      ],
    }
    const r = resumableItems(s)
    expect(r.map((i) => i.email)).toEqual(['b@x.io', 'c@x.io']) // failed items теж повертаються (для UI)
  })

  it('повертає порожній масив якщо всі done', () => {
    const s: AutoregResumeState = {
      ...emptyState('x.io'),
      items: [
        { email: 'a@x.io', pass: 'pw', phase: 'done', attempts: 1, key: 'sk_car_…' },
      ],
    }
    expect(resumableItems(s)).toHaveLength(0)
  })
})

describe('summarize', () => {
  it('рахує done/failed/remaining', () => {
    const s: AutoregResumeState = {
      ...emptyState('x.io'),
      items: [
        { email: 'a@x.io', pass: 'pw', phase: 'done', attempts: 1 },
        { email: 'b@x.io', pass: 'pw', phase: 'done', attempts: 1 },
        { email: 'c@x.io', pass: 'pw', phase: 'failed', attempts: 3, error: 'x' },
        { email: 'd@x.io', pass: 'pw', phase: 'verifying', attempts: 0 },
        { email: 'e@x.io', pass: 'pw', phase: 'waiting-mail', attempts: 0 },
      ],
    }
    const sum = summarize(s)
    expect(sum.total).toBe(5)
    expect(sum.done).toBe(2)
    expect(sum.failed).toBe(1)
    expect(sum.remaining).toBe(2)
  })
})


describe('clearState', () => {
  it('ховає файл (не видаляє) — створює .bak', () => {
    writeState(dir, emptyState('x.io'))
    const path = statePath(dir)
    expect(existsSync(path)).toBe(true)
    clearState(dir)
    expect(existsSync(path)).toBe(false)
    // має лишитися .bak з timestamp
    const filesAfter = readdirSync(dir)
    expect(filesAfter.some((f) => f.startsWith('autoreg-state.json.bak-'))).toBe(true)
  })
})
