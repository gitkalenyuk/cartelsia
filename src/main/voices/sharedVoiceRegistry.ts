import { join } from 'path'
import type {
  CartesiaVoice,
  SharedAddResult,
  SharedCheckResult,
  SharedVoiceEntry
} from '../../shared/types'
import type { CartesiaClient, VoiceProFacts } from '../cartesia/client'
import { CartesiaError } from '../cartesia/errors'
import { loadJson, saveJson } from '../persistence/jsonStore'

const ALIAS_RE = /^[a-z0-9-]{2,40}$/
// Cartesia voice UUID: стандартний uuid4 у даних поля зустрічається і без дефісів —
// приймаємо обидва варіанти, мережева перевірка все одно головна
const VOICE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Оновлений запис голосу від API (is_owner/access/fine_tunes) */
interface RemoteFacts {
  ok: boolean
  found: boolean // 200
  authRejected?: boolean // 401/403
  voice?: CartesiaVoice & VoiceProFacts
  detail?: string
}

/**
 * Локальний реєстр спільних голосів (2.1).
 *
 * Факт Cartesia: публічний голос можна ВИКОРИСТОВУВАТИ будь-яким ключем по voice_id
 * (кредити списуються з ключа-запитувача), але не можна скопіювати в чужу бібліотеку.
 * Тому «зберегти голос під імʼям» = власний JSON-реєстр alias → voice_id.
 * Нічого в Cartesia не пишеться: тільки GET-перевірки при add/check.
 */
export class SharedVoiceRegistry {
  private file: string
  private entries = new Map<string, SharedVoiceEntry>() // alias → entry
  private inflightChecks = new Map<string, Promise<SharedCheckResult>>()

  constructor(
    dataDir: string,
    private client: CartesiaClient,
    /** Доступ до пулу для вибору ключа-читача; типу () => key string | undefined */
    private readerKey: () => string | undefined,
    private onLog?: (line: string) => void
  ) {
    this.file = join(dataDir, 'shared_voices.json')
    const stored = loadJson<{ entries?: SharedVoiceEntry[] }>(this.file, {})
    for (const e of stored.entries ?? []) this.entries.set(e.alias, e)
  }

  private save(): void {
    saveJson(this.file, { entries: [...this.entries.values()] })
  }

  private log(line: string): void {
    this.onLog?.(line)
  }

  list(): SharedVoiceEntry[] {
    return [...this.entries.values()].sort((a, b) => a.alias.localeCompare(b.alias))
  }

  get(alias: string): SharedVoiceEntry | undefined {
    return this.entries.get(alias.toLowerCase())
  }

  byVoiceId(voiceId: string): SharedVoiceEntry | undefined {
    return [...this.entries.values()].find((e) => e.voiceId === voiceId)
  }

  /**
   * Додати голос за ID. Жодного запису в Cartesia:
   * 1) валідація форми UUID + alias локально;
   * 2) GET /voices/{id} вибраним ключем пулу;
   * 3) приватний чужий → відмова (запис був би непридатний);
   * 4) збереження зі status='ok', last_verified=now.
   */
  async add(rawVoiceId: string, rawAlias: string): Promise<SharedAddResult> {
    const alias = rawAlias.trim().toLowerCase()
    const voiceId = rawVoiceId.trim()

    if (!ALIAS_RE.test(alias)) {
      return { error: 'Аліас: малі латинські літери, цифри, дефіси; 2–40 символів' }
    }
    if (!VOICE_ID_RE.test(voiceId)) {
      return { error: 'Це не схоже на Cartesia voice ID (UUID). Скопіюйте ID із Share-діалогу' }
    }
    if (this.entries.has(alias)) {
      return { error: `Аліас «${alias}» уже зайнятий` }
    }
    const dupe = this.byVoiceId(voiceId)
    if (dupe) {
      return { error: `Цей голос вже в реєстрі під аліасом «${dupe.alias}»` }
    }

    const facts = await this.fetchRemote(voiceId)
    if (!facts.ok || !facts.voice) {
      return { error: facts.detail ?? 'Голос недоступний' }
    }
    const v = facts.voice
    const isOwner = v.isOwner
    const isPublic = v.isPublic

    // Приватний чужий — не зберігаємо непридатний запис
    if (!isPublic && !isOwner) {
      return {
        error:
          'Голос приватний і належить іншому акаунту. Власник має натиснути Share → Shared — тоді його можна буде використовувати за ID'
      }
    }

    // PVC: запамʼятовуємо сумісні моделі одразу
    const compatibleModels = v.compatibleModels

    const entry: SharedVoiceEntry = {
      alias,
      voiceId,
      remoteName: v.name,
      language: v.language,
      accent: undefined,
      isOwner,
      access: isPublic ? 'public' : 'private',
      isPro: !!v.isPro,
      compatibleModels,
      addedAt: new Date().toISOString(),
      lastVerified: new Date().toISOString(),
      status: 'ok'
    }
    this.entries.set(alias, entry)
    this.save()
    this.log(`[shared] Додано «${alias}» → ${maskId(voiceId)} (${v.name}, ${v.language})`)
    return { entry }
  }

  remove(alias: string): boolean {
    const key = alias.trim().toLowerCase()
    if (!this.entries.has(key)) return false
    this.entries.delete(key)
    this.save()
    this.log(`[shared] Видалено «${key}» з реєстру (сам голос на Cartesia не чіпається)`)
    return true
  }

  /**
   * Перевірка одного або всіх: re-GET, оновлення статусу.
   * Паралельні виклики для одного alias дедуплікуються.
   */
  async check(alias?: string): Promise<SharedCheckResult[]> {
    const targets = alias
      ? [this.entries.get(alias.trim().toLowerCase())].filter(Boolean as unknown as (e: SharedVoiceEntry | undefined) => e is SharedVoiceEntry)
      : [...this.entries.values()]
    return Promise.all(targets.map((e) => this.checkOne(e)))
  }

  /** Перевірка з дедуплікацією інфлайтів — для пребатч-гейта scheduler'а */
  checkCached(entry: SharedVoiceEntry): Promise<SharedCheckResult> {
    const inflight = this.inflightChecks.get(entry.alias)
    if (inflight) return inflight
    const p = this.checkOne(entry).finally(() => this.inflightChecks.delete(entry.alias))
    this.inflightChecks.set(entry.alias, p)
    return p
  }

  private async checkOne(entry: SharedVoiceEntry): Promise<SharedCheckResult> {
    const facts = await this.fetchRemote(entry.voiceId)
    let status: SharedVoiceEntry['status']
    let detail: string | undefined
    if (facts.ok && facts.voice) {
      const nowPublic = facts.voice.isPublic
      if (!nowPublic && !facts.voice.isOwner) {
        status = 'revoked'
        detail = 'Власник закрив доступ (Share → Private)'
      } else {
        status = 'ok'
        // оновлюємо факти, якщо змінились
        entry.access = nowPublic ? 'public' : 'private'
        entry.remoteName = facts.voice.name
        if (facts.voice.compatibleModels?.length) entry.compatibleModels = facts.voice.compatibleModels
      }
    } else {
      status = facts.authRejected ? 'unreachable' : 'revoked'
      detail = facts.detail
    }
    entry.status = status
    entry.lastVerified = new Date().toISOString()
    this.save()
    return { alias: entry.alias, voiceId: entry.voiceId, status, detail }
  }

  /** Потрібна повторна перевірка? (>24 год) */
  stale(entry: SharedVoiceEntry): boolean {
    return Date.now() - Date.parse(entry.lastVerified) > 24 * 3600 * 1000
  }

  /**
   * Пребатч-гейт: перед прогоном переконуємось що всі спільні голоси в черзі живі.
   * Повертає список відкликаних; порожній = можна генерувати.
   *
   * Ревокація може статись будь-якої миті без попередження, тому перед КОЖНИМ
   * прогоном voice re-verifuється напряму (GET /voices/{id}) — кеш last_verified
   * тут не аргумент. Ніколи не мовчки підмінюємо голос: відео з чужим голосом
   * гірше за впалий рендер.
   */
  async verifyForChat(
    aliases: Array<string | undefined>
  ): Promise<{ revoked: SharedCheckResult[] }> {
    const unique = [...new Set(aliases.filter((a): a is string => !!a))]
    const checks = await Promise.all(
      unique.map(async (al) => {
        const entry = this.entries.get(al.toLowerCase())
        if (!entry) {
          return { alias: al, voiceId: '?', status: 'revoked' as const, detail: 'Запис видалено з реєстру' }
        }
        return this.checkCached(entry)
      })
    )
    return { revoked: checks.filter((c) => c.status !== 'ok') }
  }

  // ── internals ────────────────────────────────────────────

  /** GET /voices/{id} ключем пулу з класифікацією помилок */
  private async fetchRemote(voiceId: string): Promise<RemoteFacts> {
    const key = this.readerKey()
    if (!key) return { ok: false, found: false, detail: 'Немає жодного ключа пулу для перевірки голосу' }
    try {
      const voice = await this.client.getVoice(key, voiceId)
      return { ok: true, found: true, voice }
    } catch (err) {
      if (err instanceof CartesiaError) {
        if (err.kind === 'not_found') {
          return {
            ok: false,
            found: false,
            detail: 'Голос не знайдено: він може бути приватним або ID хибний'
          }
        }
        if (err.kind === 'auth') {
          return {
            ok: false,
            found: false,
            authRejected: true,
            detail: `Ключ відхилено або голос недоступний этому акаунту${err.requestId ? ` (request_id: ${err.requestId})` : ''}`
          }
        }
        return { ok: false, found: false, detail: `${err.message}${err.requestId ? ` (request_id: ${err.requestId})` : ''}` }
      }
      return { ok: false, found: false, detail: err instanceof Error ? err.message : String(err) }
    }
  }
}

function maskId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}
