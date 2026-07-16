import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import type {
  CartesiaVoice,
  ClonedVoiceMeta,
  VoiceFavorite
} from '../../shared/types'
import { DEFAULT_GENERATION_SETTINGS } from '../../shared/types'
import type { CartesiaClient } from '../cartesia/client'
import type { KeyPool } from '../keys/keyPool'
import { loadJson, saveJson } from '../persistence/jsonStore'
import { sampleTextFor } from './sampleTexts'

export class VoicesService {
  private favoritesFile: string
  private clonesFile: string
  private favorites: VoiceFavorite[]
  private clones: ClonedVoiceMeta[]
  private previewsDir: string
  private inflightPreviews = new Map<string, Promise<string>>()

  constructor(
    dataDir: string,
    private client: CartesiaClient,
    private pool: KeyPool
  ) {
    this.favoritesFile = join(dataDir, 'favorites.json')
    this.clonesFile = join(dataDir, 'clones.json')
    this.previewsDir = join(dataDir, 'previews')
    mkdirSync(this.previewsDir, { recursive: true })
    this.favorites = loadJson<VoiceFavorite[]>(this.favoritesFile, [])
    this.clones = loadJson<ClonedVoiceMeta[]>(this.clonesFile, [])
  }

  previewPath(fileName: string): string {
    return join(this.previewsDir, fileName)
  }

  /**
   * Семпл голосу: оригінал з API (кешується) або TTS-генерація короткої фрази
   * мовою голосу/фільтра (~30-40 символів, кешується назавжди).
   * Повертає імʼя файла в data/previews для media://sample/<file>.
   */
  async getPreview(opts: {
    voiceId: string
    previewUrl?: string
    language?: string
  }): Promise<{ file: string; generated: boolean }> {
    const lang = opts.language || 'orig'
    const cacheKey = `${opts.voiceId}.${opts.previewUrl ? 'orig' : lang}`
    const inflight = this.inflightPreviews.get(cacheKey)
    if (inflight) return { file: await inflight, generated: !opts.previewUrl }

    const work = (async (): Promise<string> => {
      // оригінальний семпл
      if (opts.previewUrl) {
        const fileName = `${opts.voiceId}.orig.mp3`
        const abs = this.previewPath(fileName)
        if (existsSync(abs)) return fileName
        const { key } = this.libraryKey()
        const { data } = await this.client.fetchPreview(key, opts.previewUrl)
        writeFileSync(abs, data)
        return fileName
      }
      // згенерований семпл
      const fileName = `${opts.voiceId}.${lang}.mp3`
      const abs = this.previewPath(fileName)
      if (existsSync(abs)) return fileName
      const text = sampleTextFor(opts.language)
      const keyPub = this.pool
        .listPublic()
        .find((k) => k.status === 'active' && k.remaining >= text.length)
      const owningClone = this.clones.find((c) => c.id === opts.voiceId)
      const useKeyId = owningClone?.owningKeyId ?? keyPub?.id
      if (!useKeyId) throw new Error('Немає активного ключа для генерації семплу')
      const raw = this.pool.getRaw(useKeyId)
      if (!raw) throw new Error('Ключ не знайдено')
      const res = await this.client.ttsBytes(raw.key, text, {
        ...DEFAULT_GENERATION_SETTINGS,
        voiceId: opts.voiceId,
        language: opts.language,
        output: { container: 'mp3', sampleRate: 44100, bitRate: 128000 }
      })
      writeFileSync(abs, res.audio)
      this.pool.recordUsage(useKeyId, text.length, { kind: 'tts' })
      return fileName
    })()

    this.inflightPreviews.set(cacheKey, work)
    try {
      const file = await work
      return { file, generated: !opts.previewUrl }
    } finally {
      this.inflightPreviews.delete(cacheKey)
    }
  }

  /** Перший активний (або хоч якийсь) ключ для браузингу бібліотеки голосів */
  private libraryKey(preferredKeyId?: string): { id: string; key: string } {
    const all = this.pool.listPublic()
    const pick =
      (preferredKeyId && all.find((k) => k.id === preferredKeyId)) ||
      all.find((k) => k.status === 'active') ||
      all.find((k) => k.status === 'frozen') // заморожений ключ все ще може читати голоси
    if (!pick) throw new Error('Немає жодного ключа для завантаження голосів')
    const raw = this.pool.getRaw(pick.id)!
    return { id: raw.id, key: raw.key }
  }

  async list(opts: {
    keyId?: string
    q?: string
    gender?: string
    language?: string
    isOwner?: boolean
    cursor?: string
  }): Promise<{ data: CartesiaVoice[]; hasMore: boolean; nextCursor?: string }> {
    const { key } = this.libraryKey(opts.keyId)
    return this.client.listVoices(key, opts)
  }

  async clone(opts: {
    keyId?: string
    name: string
    language: string
    description?: string
    clip: ArrayBuffer
    mimeType: string
  }): Promise<ClonedVoiceMeta> {
    const { id: keyId, key } = this.libraryKey(opts.keyId)
    const ext = opts.mimeType.includes('webm')
      ? 'webm'
      : opts.mimeType.includes('ogg')
        ? 'ogg'
        : opts.mimeType.includes('wav')
          ? 'wav'
          : 'mp3'
    const voice = await this.client.cloneVoice(key, {
      clip: Buffer.from(opts.clip),
      mimeType: opts.mimeType,
      fileName: `clip.${ext}`,
      name: opts.name,
      language: opts.language,
      description: opts.description
    })
    const pub = this.pool.listPublic().find((k) => k.id === keyId)
    const meta: ClonedVoiceMeta = {
      id: voice.id,
      name: voice.name,
      language: voice.language,
      description: voice.description,
      owningKeyId: keyId,
      owningKeyLabel: pub?.label ?? '',
      clonedAt: new Date().toISOString()
    }
    this.clones.push(meta)
    saveJson(this.clonesFile, this.clones)
    return meta
  }

  async localize(opts: {
    voiceId: string
    name: string
    language: string
    originalSpeakerGender: 'male' | 'female'
    keyId?: string
  }): Promise<ClonedVoiceMeta> {
    // локалізація клону мусить іти через ключ-власник
    const owningClone = this.clones.find((c) => c.id === opts.voiceId)
    const { id: keyId, key } = this.libraryKey(owningClone?.owningKeyId ?? opts.keyId)
    const voice = await this.client.localizeVoice(key, opts)
    const pub = this.pool.listPublic().find((k) => k.id === keyId)
    const meta: ClonedVoiceMeta = {
      id: voice.id,
      name: voice.name,
      language: voice.language,
      description: voice.description,
      owningKeyId: keyId,
      owningKeyLabel: pub?.label ?? '',
      clonedAt: new Date().toISOString(),
      localizedFrom: opts.voiceId
    }
    this.clones.push(meta)
    saveJson(this.clonesFile, this.clones)
    return meta
  }

  async deleteClone(voiceId: string): Promise<void> {
    const clone = this.clones.find((c) => c.id === voiceId)
    if (clone) {
      const raw = this.pool.getRaw(clone.owningKeyId)
      if (raw) await this.client.deleteVoice(raw.key, voiceId)
    }
    this.clones = this.clones.filter((c) => c.id !== voiceId)
    saveJson(this.clonesFile, this.clones)
    this.favorites = this.favorites.filter((f) => f.id !== voiceId)
    saveJson(this.favoritesFile, this.favorites)
  }

  listClones(): ClonedVoiceMeta[] {
    return this.clones
  }

  /**
   * Сканує ВСІ ключі (пул + клон-ключі) на власні голоси (is_owner=true)
   * і реєструє знайдені клони локально. Клони, створені на сайті, підтягуються сюди.
   */
  async scanClones(): Promise<{
    clones: ClonedVoiceMeta[]
    scannedKeys: number
    errors: { keyLabel: string; message: string }[]
  }> {
    const errors: { keyLabel: string; message: string }[] = []
    let scannedKeys = 0
    for (const pub of this.pool.listPublic()) {
      if (pub.status === 'invalid') continue
      const raw = this.pool.getRaw(pub.id)
      if (!raw) continue
      scannedKeys++
      try {
        let cursor: string | undefined
        do {
          const page = await this.client.listVoices(raw.key, {
            isOwner: true,
            limit: 100,
            cursor
          })
          for (const v of page.data) {
            const existing = this.clones.find((c) => c.id === v.id)
            if (existing) {
              existing.owningKeyId = pub.id
              existing.owningKeyLabel = pub.label
              existing.name = v.name
              existing.language = v.language
            } else {
              this.clones.push({
                id: v.id,
                name: v.name,
                language: v.language,
                description: v.description,
                owningKeyId: pub.id,
                owningKeyLabel: pub.label,
                clonedAt: v.createdAt ?? new Date().toISOString()
              })
            }
          }
          cursor = page.hasMore ? page.nextCursor : undefined
        } while (cursor)
      } catch (err) {
        errors.push({
          keyLabel: pub.label,
          message: err instanceof Error ? err.message : String(err)
        })
      }
    }
    saveJson(this.clonesFile, this.clones)
    return { clones: this.clones, scannedKeys, errors }
  }

  cloneOwner(voiceId: string): string | undefined {
    return this.clones.find((c) => c.id === voiceId)?.owningKeyId
  }

  listFavorites(): VoiceFavorite[] {
    return this.favorites
  }

  toggleFavorite(voice: Omit<VoiceFavorite, 'addedAt'>): VoiceFavorite[] {
    const idx = this.favorites.findIndex((f) => f.id === voice.id)
    if (idx >= 0) this.favorites.splice(idx, 1)
    else this.favorites.push({ ...voice, addedAt: new Date().toISOString() })
    saveJson(this.favoritesFile, this.favorites)
    return this.favorites
  }

}
