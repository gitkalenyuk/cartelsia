import { EventEmitter } from 'events'
import { join } from 'path'
import {
  DEFAULT_KEY_LIMIT,
  FREEZE_THRESHOLD,
  PER_KEY_CONCURRENCY,
  type AddKeysResult,
  type ApiKey,
  type ApiKeyPublic,
  type FreezeReason
} from '../../shared/types'
import { loadJson, saveJson } from '../persistence/jsonStore'
import type { CartesiaClient } from '../cartesia/client'
import type { UsageLedger } from '../persistence/usageLedger'

/**
 * Момент розморозки = 00:00 1-го числа наступного місяця.
 * Cartesia скидає кредити 1 числа календарного місяця (перевірено на дашборді:
 * «Credits refresh on Aug 1»), а не через місяць від вичерпання.
 */
export function nextCreditReset(from: Date): Date {
  return new Date(from.getFullYear(), from.getMonth() + 1, 1, 0, 0, 0, 0)
}

export function maskKey(key: string): string {
  if (key.length <= 12) return key
  return `${key.slice(0, 7)}…${key.slice(-4)}`
}

const KEY_FORMAT = /^sk_car_[A-Za-z0-9_-]{10,}$/

export interface KeyPoolEvents {
  'key-updated': (key: ApiKeyPublic) => void
  'keys-available': () => void
}

export class KeyPool extends EventEmitter {
  private keys: ApiKey[] = []
  private slots = new Map<string, number>() // keyId → зайняті слоти (runtime)
  private file: string
  private tickTimer?: NodeJS.Timeout

  constructor(
    dataDir: string,
    private client: CartesiaClient,
    private ledger: UsageLedger,
    private now: () => Date = () => new Date()
  ) {
    super()
    this.file = join(dataDir, 'keys.json')
    this.keys = loadJson<ApiKey[]>(this.file, [])
  }

  /** Періодична перевірка розморозки — НЕ setTimeout на місяць (32-бітний ліміт таймера) */
  startTicking(intervalMs = 60_000): void {
    this.tickTimer = setInterval(() => this.tick(), intervalMs)
    this.tick()
  }

  stopTicking(): void {
    if (this.tickTimer) clearInterval(this.tickTimer)
  }

  tick(): void {
    let anyUnfrozen = false
    for (const k of this.keys) {
      if (k.status === 'frozen' && k.frozenUntil && new Date(k.frozenUntil) <= this.now()) {
        k.status = 'active'
        k.usedChars = 0
        k.frozenAt = undefined
        k.frozenUntil = undefined
        k.freezeReason = undefined
        anyUnfrozen = true
        this.emit('key-updated', this.toPublic(k))
      }
    }
    if (anyUnfrozen) {
      this.persist()
      this.emit('keys-available')
    }
  }

  private persist(): void {
    saveJson(this.file, this.keys)
  }

  toPublic(k: ApiKey): ApiKeyPublic {
    const { key: _secret, ...rest } = k
    return {
      ...rest,
      keyMasked: maskKey(k.key),
      activeSlots: this.slots.get(k.id) ?? 0,
      remaining: this.remaining(k)
    }
  }

  listPublic(): ApiKeyPublic[] {
    return this.keys.map((k) => this.toPublic(k))
  }

  getRaw(keyId: string): ApiKey | undefined {
    return this.keys.find((k) => k.id === keyId)
  }

  remaining(k: ApiKey): number {
    return Math.max(0, k.limit - k.usedChars)
  }

  activeCount(): number {
    return this.keys.filter((k) => k.status === 'active').length
  }

  /** Додавання ключів (вручну або з файлу) з дедуплікацією і авто-валідацією */
  async addKeys(
    rawKeys: string[],
    label?: string,
    role: 'pool' | 'clone' = 'pool'
  ): Promise<AddKeysResult> {
    const result: AddKeysResult = { added: [], rejected: [] }
    const seen = new Set(this.keys.map((k) => k.key))

    for (const raw of rawKeys) {
      const key = raw.trim()
      if (!key) continue
      if (!KEY_FORMAT.test(key)) {
        result.rejected.push({ key: maskKey(key), reason: 'format' })
        continue
      }
      if (seen.has(key)) {
        result.rejected.push({ key: maskKey(key), reason: 'duplicate' })
        continue
      }
      seen.add(key)

      let valid = false
      try {
        valid = await this.client.validateKey(key)
      } catch {
        // мережева помилка — додаємо як активний, перевірка можлива пізніше кнопкою
        valid = true
      }

      const entry: ApiKey = {
        id: crypto.randomUUID(),
        key,
        label:
          label ||
          (role === 'clone'
            ? `Клон-ключ ${this.keys.filter((k) => k.role === 'clone').length + 1}`
            : `Ключ ${this.keys.filter((k) => k.role !== 'clone').length + 1}`),
        usedChars: 0,
        limit: DEFAULT_KEY_LIMIT,
        status: valid ? 'active' : 'invalid',
        role,
        createdAt: this.now().toISOString(),
        lastValidatedAt: this.now().toISOString()
      }
      this.keys.push(entry)
      result.added.push(this.toPublic(entry))
    }
    this.persist()
    if (result.added.some((k) => k.status === 'active')) this.emit('keys-available')
    return result
  }

  update(keyId: string, patch: { label?: string; limit?: number; usedChars?: number }): ApiKeyPublic {
    const k = this.mustGet(keyId)
    if (patch.label !== undefined) k.label = patch.label
    if (patch.limit !== undefined) k.limit = Math.max(0, Math.floor(patch.limit))
    if (patch.usedChars !== undefined) k.usedChars = Math.max(0, Math.floor(patch.usedChars))
    // зміна ліміту може вивести ключ із «майже порожнього» стану — переоцінюємо заморозку
    if (k.status === 'active' && this.remaining(k) < FREEZE_THRESHOLD) {
      this.freeze(keyId, 'low-remaining')
    }
    this.persist()
    const pub = this.toPublic(k)
    this.emit('key-updated', pub)
    return pub
  }

  remove(keyId: string): void {
    this.keys = this.keys.filter((k) => k.id !== keyId)
    this.slots.delete(keyId)
    this.persist()
  }

  /** Успішна генерація: ledger + перевірка порогу заморозки */
  recordUsage(keyId: string, chars: number, meta: { chatId?: string; chunkId?: string; kind?: 'tts' | 'probe' } = {}): void {
    const k = this.mustGet(keyId)
    k.usedChars += chars
    this.ledger.append({
      ts: this.now().toISOString(),
      keyId,
      chatId: meta.chatId,
      chunkId: meta.chunkId,
      chars,
      kind: meta.kind ?? 'tts'
    })
    if (k.status === 'active' && this.remaining(k) < FREEZE_THRESHOLD) {
      this.freeze(keyId, 'low-remaining')
    } else {
      this.persist()
      this.emit('key-updated', this.toPublic(k))
    }
  }

  /** Заморозка до 1-го числа наступного місяця (коли Cartesia скидає кредити) */
  freeze(keyId: string, reason: FreezeReason): void {
    const k = this.mustGet(keyId)
    const now = this.now()
    k.status = 'frozen'
    k.frozenAt = now.toISOString()
    k.frozenUntil = nextCreditReset(now).toISOString()
    k.freezeReason = reason
    if (reason === 'quota_exceeded') k.usedChars = k.limit // звірка ledger із реальністю
    this.persist()
    this.emit('key-updated', this.toPublic(k))
  }

  markInvalid(keyId: string): void {
    const k = this.mustGet(keyId)
    k.status = 'invalid'
    this.persist()
    this.emit('key-updated', this.toPublic(k))
  }

  /**
   * Ручна перевірка ключа кнопкою:
   * - авто-валідація через /access-token (безкоштовно)
   * - опційний quota-probe 1-символьною генерацією (~1 кредит): успіх для замороженого
   *   ключа означає, що ліміт реально скинувся → розморожуємо, usedChars = 0
   */
  async probe(
    keyId: string,
    quotaProbe: { run: (rawKey: string) => Promise<void> } | null
  ): Promise<{ authValid: boolean; quotaOk?: boolean; key: ApiKeyPublic }> {
    const k = this.mustGet(keyId)
    let authValid = false
    try {
      authValid = await this.client.validateKey(k.key)
    } catch {
      authValid = false
    }
    k.lastValidatedAt = this.now().toISOString()

    let quotaOk: boolean | undefined
    if (authValid && quotaProbe) {
      try {
        await quotaProbe.run(k.key)
        quotaOk = true
        if (k.status === 'frozen') {
          k.status = 'active'
          k.usedChars = 0
          k.frozenAt = undefined
          k.frozenUntil = undefined
          k.freezeReason = undefined
          this.emit('keys-available')
        }
        this.ledger.append({ ts: this.now().toISOString(), keyId, chars: 1, kind: 'probe' })
        k.usedChars += 1
      } catch {
        quotaOk = false
      }
    }
    if (!authValid) k.status = 'invalid'
    else if (k.status === 'invalid') k.status = 'active'

    this.persist()
    const pub = this.toPublic(k)
    this.emit('key-updated', pub)
    return { authValid, quotaOk, key: pub }
  }

  // ---------- Слоти (семафор 2 на ключ) ----------
  freeSlots(keyId: string): number {
    return PER_KEY_CONCURRENCY - (this.slots.get(keyId) ?? 0)
  }

  acquireSlot(keyId: string): boolean {
    if (this.freeSlots(keyId) <= 0) return false
    this.slots.set(keyId, (this.slots.get(keyId) ?? 0) + 1)
    return true
  }

  releaseSlot(keyId: string): void {
    const cur = this.slots.get(keyId) ?? 0
    this.slots.set(keyId, Math.max(0, cur - 1))
  }

  totalBusySlots(): number {
    let sum = 0
    for (const v of this.slots.values()) sum += v
    return sum
  }

  /**
   * Кандидати для чанка вартістю cost:
   * активні, з remaining ≥ cost, з вільним слотом, не з excluded.
   * Клон-голос → тільки pinnedKeyId.
   * Сортування BEST-FIT: найменший remaining, що вміщує (добиваємо ключі до кінця).
   */
  candidatesFor(cost: number, pinnedKeyId?: string, excluded?: Set<string>): ApiKey[] {
    return this.keys
      .filter((k) => {
        if (pinnedKeyId && k.id !== pinnedKeyId) return false
        // клон-ключі працюють ТІЛЬКИ для своїх клон-голосів (pinned)
        if (!pinnedKeyId && k.role === 'clone') return false
        if (k.status !== 'active') return false
        if (this.remaining(k) < cost) return false
        if (this.freeSlots(k.id) <= 0) return false
        if (excluded?.has(k.id)) return false
        return true
      })
      .sort((a, b) => {
        const diff = this.remaining(a) - this.remaining(b)
        if (diff !== 0) return diff
        return (this.slots.get(a.id) ?? 0) - (this.slots.get(b.id) ?? 0)
      })
  }

  /** Чи є АКТИВНИЙ ключ, що вміщує чанк (незалежно від зайнятості слотів) */
  anyActiveKeyFits(cost: number, pinnedKeyId?: string): boolean {
    return this.keys.some(
      (k) =>
        k.status === 'active' &&
        this.remaining(k) >= cost &&
        (pinnedKeyId ? k.id === pinnedKeyId : k.role !== 'clone')
    )
  }

  /** Чи зможе якийсь ключ КОЛИСЬ узяти чанк такої вартості (для waiting-key vs blocked) */
  anyKeyCouldEver(cost: number, pinnedKeyId?: string): boolean {
    return this.keys.some((k) => {
      if (pinnedKeyId ? k.id !== pinnedKeyId : k.role === 'clone') return false
      if (k.status === 'invalid') return false
      if (k.status === 'frozen') return k.limit >= cost // після розморозки ліміт скидається
      return this.remaining(k) >= cost || k.limit >= cost // заморозиться і скинеться
    })
  }

  /** Найближчий момент розморозки (для scheduler-paused resumeAt) */
  earliestUnfreeze(): string | undefined {
    const dates = this.keys
      .filter((k) => k.status === 'frozen' && k.frozenUntil)
      .map((k) => k.frozenUntil!)
      .sort()
    return dates[0]
  }

  private mustGet(keyId: string): ApiKey {
    const k = this.keys.find((x) => x.id === keyId)
    if (!k) throw new Error(`Ключ не знайдено: ${keyId}`)
    return k
  }
}
