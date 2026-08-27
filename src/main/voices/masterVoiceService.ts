import { join } from 'path'
import type {
  CartesiaVoice,
  ClonedVoiceMeta,
  MasterCloneResult,
  MasterStatus,
  Settings
} from '../../shared/types'
import type { CartesiaClient } from '../cartesia/client'
import { CartesiaError } from '../cartesia/errors'
import { toCartesiaError } from '../cartesia/errors'
import { withRetry } from '../cartesia/retry'
import { preprocessAudio, sha256Hex } from '../audio/preprocess'
import { loadJson, saveJson } from '../persistence/jsonStore'

interface VoiceRegistryEntry {
  audioSha256: string
  voiceId: string
  name: string
  language: string
  createdAt: string
  madePublicAt?: string
}

/**
 * Master-клонування голосів (2.0.1):
 * майстер Pro-ключ → POST /voices/clone → PATCH access=public → голос доступний
 * для TTS з будь-яких безкоштовних ключів пулу.
 *
 * Гарантії:
 * - дедуплікація: той самий аудіо (SHA-256) ніколи не клонується двічі
 * - зіткнення між інсталяціями вирішуються синхронізацією GET /voices?is_owner=true
 * - 429/5xx повторюються ×5 (exp backoff + jitter), інші 4xx — ні
 */
export class MasterVoiceService {
  private registryFile: string
  private registry = new Map<string, VoiceRegistryEntry>() // sha256 → entry

  /** паралельні запити на мастер-ключ (Pro=3; Free 2 | Startup 5 | Scale 15) */
  private concurrency = 3
  private inflight = 0
  private queue: Array<() => void> = []

  constructor(
    dataDir: string,
    private client: CartesiaClient,
    private getSettings: () => Settings
  ) {
    this.registryFile = join(dataDir, 'master_voices.json')
    this.concurrency = Math.max(1, Math.min(15, getSettings().masterConcurrency ?? 3))
  }

  /** лог-хук ставиться зовні після конструктора */
  onLog?: (line: string) => void

  private log(line: string): void {
    this.onLog?.(line)
  }

  // ── семафор ─────────────────────────────────────────────

  private async acquire(): Promise<void> {
    if (this.inflight < this.concurrency) {
      this.inflight++
      return
    }
    await new Promise<void>((resolve) => this.queue.push(resolve))
    this.inflight++
  }

  private release(): void {
    this.inflight--
    const next = this.queue.shift()
    if (next) next()
  }

  // ── master-ключ ─────────────────────────────────────────

  private key(): string {
    const k = this.getSettings().masterApiKey?.trim()
    if (!k) throw new Error('Master API-ключ не заданий — додайте його в Налаштуваннях')
    return k
  }

  /** Статус мастер-ключа + тариф (дешева перевірка access-token) */
  async status(): Promise<MasterStatus> {
    const k = this.getSettings().masterApiKey?.trim()
    if (!k) return { configured: false }
    try {
      const ok = await this.client.validateKey(k)
      if (!ok) return { configured: true, valid: false, error: 'Ключ невалідний' }
      return { configured: true, valid: true, plan: await this.detectPlan(k) }
    } catch (err) {
      return {
        configured: true,
        valid: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  /**
   * Визначення тарифу через API: прямого endpoint немає — лишається 'unknown',
   * користувач може вказати ліміт паралельності вручну в Налаштуваннях.
   */
  private async detectPlan(_key: string): Promise<MasterStatus['plan']> {
    return 'unknown'
  }

  setConcurrency(n: number): void {
    this.concurrency = Math.max(1, Math.min(15, n))
  }

  // ── реєстр (sha256 → voiceId) ───────────────────────────

  async ensureLoaded(): Promise<void> {
    if (this.registry.size) return
    const stored = loadJson<{ entries?: VoiceRegistryEntry[] }>(this.registryFile, {})
    for (const e of stored.entries ?? []) this.registry.set(e.audioSha256, e)
  }

  private save(): void {
    saveJson(this.registryFile, { entries: [...this.registry.values()] })
  }

  // ── клонування ──────────────────────────────────────────

  /**
   * Повний шлях: препроцесинг ffmpeg → SHA-256 дедуп → клон master-ключем →
   * (опційно) PATCH access=public. Реєстр оновлюється до і після запиту.
   */
  async clone(opts: {
    clip: Buffer
    mimeType: string
    name: string
    language: string
    description?: string
    accent?: string
    makePublic?: boolean
  }): Promise<MasterCloneResult> {
    await this.ensureLoaded()
    const key = this.key()

    // 1) препроцесинг
    this.log('[master] Обробка аудіо (ffmpeg: silence trim, loudnorm, mono 44.1k)…')
    const pre = await preprocessAudio(Buffer.from(opts.clip))
    if (pre.durationSec < 1)
      throw new Error(`Кліп занадто короткий після обробки (${pre.durationSec.toFixed(1)} с); потрібно 1–10 с`)

    // 2) дедуплікація
    const hash = await sha256Hex(pre.buffer)
    const known = this.registry.get(hash)
    if (known) {
      this.log(`[master] Таке аудіо вже заклоноване раніше — повертаю ${known.voiceId} (${known.name})`)
      let voice: CartesiaVoice
      let madePublic = false
      try {
        voice = await withRetry(() => this.getVoice(key, known.voiceId))
        madePublic = await this.ensurePublic(key, voice, opts.makePublic ?? this.autoPublic())
        return { voice, reused: true, madePublic }
      } catch (err) {
        // голос міг бути видалений на боці Cartesia — переклоновуємо
        this.log(
          `[master] Голос ${known.voiceId} недоступний (${
            err instanceof Error ? err.message : String(err)
          }), переклоновую…`
        )
      }
    }

    // 3) акцент (якщо заданий) перевіряється по GET /accents
    const accent = opts.accent?.trim() || undefined
    if (accent && !(await this.validateAccent(key, accent))) {
      throw new Error(
        `Акцент "${accent}" невалідний — список валідних: GET /accents ( див. довідку )`
      )
    }

    this.log(`[master] Клоную голос «${opts.name}» (${opts.language})…`)
    const makePublic = opts.makePublic ?? this.autoPublic()
    const voice = await this.acquireWrap(() =>
      withRetry(() =>
        this.client.cloneVoice(key, {
          clip: pre.buffer,
          mimeType: pre.mimeType,
          fileName: pre.fileName,
          name: opts.name.trim().slice(0, 64),
          language: opts.language,
          description: opts.description?.trim().slice(0, 500),
          accent,
          access: makePublic ? 'public' : undefined
        })
      )
    )

    // 4) реєструємо ДО публікації, щоб crash між кроками не вдублював клонування
    this.registry.set(hash, {
      audioSha256: hash,
      voiceId: voice.id,
      name: voice.name,
      language: voice.language,
      createdAt: new Date().toISOString(),
      madePublicAt: makePublic ? new Date().toISOString() : undefined
    })
    this.save()

    const madePublic = await this.ensurePublic(key, voice, makePublic)

    this.log(`[master] ✅ Голос створено: ${voice.id}`)
    return { voice, reused: false, madePublic }
  }

  private autoPublic(): boolean {
    return this.getSettings().masterAutoPublic !== false // default true
  }

  /** PATCH access=public, якщо ще не публічний */
  private async ensurePublic(
    key: string,
    voice: CartesiaVoice,
    makePublic: boolean
  ): Promise<boolean> {
    if (!makePublic) return false
    if (voice.isPublic) return false
    this.log('[master] Роблю голос публічним (PATCH access=public)…')
    const updated = await withRetry(() => this.client.updateVoice(key, voice.id, { access: 'public' }))
    return updated.isPublic
  }

  private async validateAccent(key: string, accent: string): Promise<boolean> {
    try {
      const list = await withRetry(() => this.client.getAccents(key))
      return list.includes(accent)
    } catch {
      return true // accents endpoint недоступний — не блокуємо клонування
    }
  }

  /** GET /voices/{id} — точна перевірка (listVoices не дає точного пошуку по id) */
  private async getVoice(key: string, voiceId: string): Promise<CartesiaVoice> {
    return this.client.getVoice(key, voiceId)
  }

  private async acquireWrap<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }

  /**
   * Синхронізація локального реєстру із сервером: усі власні голоси мастера
   * (is_owner=true) на резерв, що voice_id існує навіть якщо локальний файл губиться.
   */
  async syncFromServer(): Promise<CartesiaVoice[]> {
    const key = this.key()
    const all: CartesiaVoice[] = []
    let cursor: string | undefined
    do {
      const page = await withRetry(() =>
        this.client.listVoices(key, { isOwner: true, limit: 100, cursor })
      )
      all.push(...page.data)
      cursor = page.hasMore ? page.nextCursor : undefined
    } while (cursor)
    return all
  }

  /** Загорнути sync результат у ClonedVoiceMeta для UI (має viaMaster=true) */
  async listAsMeta(existingClones: ClonedVoiceMeta[]): Promise<ClonedVoiceMeta[]> {
    const voices = await this.syncFromServer()
    const byId = new Map(existingClones.map((c) => [c.id, c]))
    return voices.map((v) => ({
      id: v.id,
      name: v.name,
      language: v.language,
      description: v.description,
      owningKeyId: 'master',
      owningKeyLabel: 'Master (Pro)',
      clonedAt: v.createdAt ?? new Date().toISOString(),
      viaMaster: true,
      isPublic: v.isPublic
    })).map((m) => ({ ...byId.get(m.id), ...m }))
  }

  /** Переключити public/private із UI */
  async togglePublic(voiceId: string): Promise<CartesiaVoice> {
    const key = this.key()
    const current = await this.getVoice(key, voiceId)
    const target = current.isPublic ? 'private' : 'public'
    this.log(`[master] ${target === 'public' ? 'Публікую' : 'Ховаю'} голос ${voiceId}…`)
    const updated = await withRetry(() =>
      this.client.updateVoice(key, voiceId, { access: target })
    )
    this.log(`[master] Готово: тепер ${updated.isPublic ? 'публічний' : 'приватний'}`)
    return updated
  }

  /** Конвертувати для Errore обробки у renderer: помилки master-потоку мають префікс */
  static errorMessage(err: unknown): string {
    if (err instanceof CartesiaError) {
      const rid = err.requestId ? ` (request_id: ${err.requestId})` : ''
      if (err.kind === 'concurrency_limited') return `Rate-limit від API${rid}`
      if (err.kind === 'quota_exceeded') return `Кредити мастер-акаунта вичерпано${rid}`
      if (err.kind === 'bad_request') {
        if (err.errorCode === 'plan_upgrade_required')
          return `Master-акаунт на Free — потрібен платний тариф для клонування`
        return `API відмовив: ${err.message}${rid}`
      }
      return `${err.message}${rid}`
    }
    return err instanceof Error ? err.message : String(err)
  }
}
