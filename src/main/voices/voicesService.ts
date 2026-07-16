import { join } from 'path'
import type {
  CartesiaVoice,
  ClonedVoiceMeta,
  VoiceFavorite
} from '../../shared/types'
import type { CartesiaClient } from '../cartesia/client'
import type { KeyPool } from '../keys/keyPool'
import { loadJson, saveJson } from '../persistence/jsonStore'

export class VoicesService {
  private favoritesFile: string
  private clonesFile: string
  private favorites: VoiceFavorite[]
  private clones: ClonedVoiceMeta[]

  constructor(
    dataDir: string,
    private client: CartesiaClient,
    private pool: KeyPool
  ) {
    this.favoritesFile = join(dataDir, 'favorites.json')
    this.clonesFile = join(dataDir, 'clones.json')
    this.favorites = loadJson<VoiceFavorite[]>(this.favoritesFile, [])
    this.clones = loadJson<ClonedVoiceMeta[]>(this.clonesFile, [])
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

  async fetchPreview(url: string): Promise<{ data: Buffer; contentType: string }> {
    return this.client.fetchPreview(url)
  }
}
