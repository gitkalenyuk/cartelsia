import {
  CARTESIA_BASE,
  CARTESIA_VERSION,
  type CartesiaVoice,
  type GenerationSettings,
  type WordTimestamps
} from '../../shared/types'
import { CartesiaError, toCartesiaError, asNetworkError } from './errors'
import { parseSse } from './sse'

export type FetchLike = typeof fetch

export interface TtsResult {
  audio: Buffer
  format: 'mp3' | 'wav'
  timestamps?: WordTimestamps
  sampleRate: number
}

interface VoicesPage {
  data: CartesiaVoice[]
  hasMore: boolean
  nextCursor?: string
}

interface RawVoice {
  id: string
  name: string
  description?: string
  language: string
  gender?: string
  is_owner?: boolean
  access?: { type?: string; visibility?: string }
  is_public?: boolean
  preview_file_url?: string
  created_at?: string
  /** Pro-клони позначаються fine_tune; локалізація/швидкість на них не впливають */
  fine_tune?: Record<string, unknown>
}

export interface RawVoiceFull extends RawVoice {
  fine_tune_public_model_id?: string
}

/** PVC-факти, які getVoice додає поверх CartesiaVoice (2.1) */
export interface VoiceProFacts {
  /** Pro Voice Clone: має обмеження сумісних моделей */
  isPro?: boolean
  /** fine_tunes[].public_model_id — моделі, з якими цей голос працює */
  compatibleModels?: string[]
}

function extractCompatibleModels(fineTune: RawVoice['fine_tune']): string[] | undefined {
  if (!fineTune) return undefined
  // API віддає або масив обʼєктів {public_model_id}, або словник — приймаємо обидва
  if (Array.isArray(fineTune)) {
    const ids = fineTune
      .map((f) => (typeof f === 'string' ? f : (f as { public_model_id?: string }).public_model_id))
      .filter((x): x is string => !!x)
    return ids.length ? ids : undefined
  }
  if (typeof fineTune === 'object') {
    const values = Object.values(fineTune)
    const ids = values
      .map((f) => (typeof f === 'string' ? f : (f as { public_model_id?: string }).public_model_id))
      .filter((x): x is string => !!x)
    return ids.length ? ids : undefined
  }
  return undefined
}

function mapVoice(v: RawVoice): CartesiaVoice {
  return {
    id: v.id,
    name: v.name,
    description: v.description,
    language: v.language,
    gender: v.gender,
    isOwner: !!v.is_owner,
    isPublic: v.access?.type === 'public' || !!v.is_public,
    previewUrl: v.preview_file_url,
    createdAt: v.created_at
  }
}

/**
 * Обгортка Cartesia API. Один інстанс на додаток; ключ передається В КОЖЕН виклик
 * (пул ключів), fetch інʼєктується для юніт-тестів.
 */
export class CartesiaClient {
  constructor(
    private fetchFn: FetchLike = fetch,
    private base: string = CARTESIA_BASE
  ) {}

  private headers(key: string, json = true): Record<string, string> {
    return {
      Authorization: `Bearer ${key}`,
      'Cartesia-Version': CARTESIA_VERSION,
      ...(json ? { 'Content-Type': 'application/json' } : {})
    }
  }

  /** Безкоштовна перевірка валідності ключа (кредити списуються тільки за успішний синтез) */
  async validateKey(key: string): Promise<boolean> {
    try {
      const res = await this.fetchFn(`${this.base}/access-token`, {
        method: 'POST',
        headers: this.headers(key),
        body: JSON.stringify({ grants: { tts: true }, expires_in: 60 })
      })
      if (res.ok) return true
      const err = await toCartesiaError(res)
      if (err.kind === 'auth') return false
      throw err
    } catch (err) {
      if (err instanceof CartesiaError && err.kind !== 'auth') throw err
      if (err instanceof CartesiaError) return false
      throw asNetworkError(err)
    }
  }

  private ttsBody(text: string, s: GenerationSettings): Record<string, unknown> {
    const generationConfig: Record<string, unknown> = {}
    if (s.speed !== undefined && s.speed !== 1) generationConfig.speed = s.speed
    if (s.volume !== undefined && s.volume !== 1) generationConfig.volume = s.volume
    if (s.emotion && s.emotion !== 'neutral') generationConfig.emotion = s.emotion

    return {
      model_id: s.modelId,
      transcript: text,
      voice: { mode: 'id', id: s.voiceId },
      ...(s.language ? { language: s.language } : {}),
      ...(Object.keys(generationConfig).length ? { generation_config: generationConfig } : {})
    }
  }

  /** POST /tts/bytes — основний шлях: одразу mp3/wav */
  async ttsBytes(key: string, text: string, s: GenerationSettings): Promise<TtsResult> {
    const outputFormat =
      s.output.container === 'mp3'
        ? {
            container: 'mp3',
            sample_rate: s.output.sampleRate,
            bit_rate: s.output.bitRate ?? 128000
          }
        : { container: 'wav', encoding: 'pcm_s16le', sample_rate: s.output.sampleRate }

    let res: Response
    try {
      res = await this.fetchFn(`${this.base}/tts/bytes`, {
        method: 'POST',
        headers: this.headers(key),
        body: JSON.stringify({ ...this.ttsBody(text, s), output_format: outputFormat })
      })
    } catch (err) {
      throw asNetworkError(err)
    }
    if (!res.ok) throw await toCartesiaError(res)
    const audio = Buffer.from(await res.arrayBuffer())
    if (audio.length === 0) throw new CartesiaError('unknown', 'Порожня аудіовідповідь')
    return { audio, format: s.output.container, sampleRate: s.output.sampleRate }
  }

  /** POST /tts/sse — субтитр-режим: raw PCM + word timestamps (обгортається у WAV вище) */
  async ttsSseWithTimestamps(
    key: string,
    text: string,
    s: GenerationSettings
  ): Promise<{ pcm: Buffer; timestamps: WordTimestamps; sampleRate: number }> {
    const sampleRate = s.output.sampleRate
    let res: Response
    try {
      res = await this.fetchFn(`${this.base}/tts/sse`, {
        method: 'POST',
        headers: this.headers(key),
        body: JSON.stringify({
          ...this.ttsBody(text, s),
          output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: sampleRate },
          add_timestamps: true
        })
      })
    } catch (err) {
      throw asNetworkError(err)
    }
    if (!res.ok) throw await toCartesiaError(res)
    if (!res.body) throw new CartesiaError('unknown', 'SSE без тіла відповіді')

    const pcmParts: Buffer[] = []
    const timestamps: WordTimestamps = { words: [], start: [], end: [] }

    for await (const event of parseSse(res.body)) {
      if (event.type === 'chunk' && typeof event.data === 'string') {
        pcmParts.push(Buffer.from(event.data, 'base64'))
      } else if (event.type === 'timestamps' && event.word_timestamps) {
        const wt = event.word_timestamps as Partial<WordTimestamps>
        timestamps.words.push(...(wt.words ?? []))
        timestamps.start.push(...(wt.start ?? []))
        timestamps.end.push(...(wt.end ?? []))
      } else if (event.type === 'error') {
        throw new CartesiaError('unknown', String(event.message ?? 'SSE error'), {
          errorCode: typeof event.error_code === 'string' ? event.error_code : undefined
        })
      } else if (event.type === 'done') {
        break
      }
    }
    return { pcm: Buffer.concat(pcmParts), timestamps, sampleRate }
  }

  /** GET /voices — сторінка голосів */
  async listVoices(
    key: string,
    opts: {
      q?: string
      gender?: string
      language?: string
      isOwner?: boolean
      cursor?: string
      limit?: number
    } = {}
  ): Promise<VoicesPage> {
    const params = new URLSearchParams()
    params.set('limit', String(opts.limit ?? 100))
    params.append('expand[]', 'preview_file_url')
    if (opts.q) params.set('q', opts.q)
    if (opts.gender) params.set('gender', opts.gender)
    if (opts.language) params.set('language', opts.language)
    if (opts.isOwner !== undefined) params.set('is_owner', String(opts.isOwner))
    if (opts.cursor) params.set('starting_after', opts.cursor)

    let res: Response
    try {
      res = await this.fetchFn(`${this.base}/voices/?${params}`, {
        headers: this.headers(key, false)
      })
    } catch (err) {
      throw asNetworkError(err)
    }
    if (!res.ok) throw await toCartesiaError(res)
    const body = (await res.json()) as { data: RawVoice[]; has_more: boolean; next_page?: string }
    const data = (body.data ?? []).map(mapVoice)
    return {
      data,
      hasMore: !!body.has_more,
      nextCursor: body.next_page ?? (data.length ? data[data.length - 1].id : undefined)
    }
  }

  /** POST /voices/clone — instant clone з аудіокліпу ≤10 с */
  async cloneVoice(
    key: string,
    opts: {
      clip: Buffer
      mimeType: string
      fileName: string
      name: string
      language: string
      description?: string
      /** Валідний accent slug з GET /accents */
      accent?: string
      /** private (default) | public — доступ до клону */
      access?: 'private' | 'public'
      tagline?: string
    }
  ): Promise<CartesiaVoice> {
    const fd = new FormData()
    fd.append('clip', new Blob([new Uint8Array(opts.clip)], { type: opts.mimeType }), opts.fileName)
    fd.append('name', opts.name)
    fd.append('language', opts.language)
    if (opts.description) fd.append('description', opts.description)
    if (opts.accent) fd.append('accent', opts.accent)
    if (opts.access) fd.append('access', opts.access)
    if (opts.tagline) fd.append('tagline', opts.tagline)

    let res: Response
    try {
      res = await this.fetchFn(`${this.base}/voices/clone`, {
        method: 'POST',
        headers: this.headers(key, false), // boundary ставить undici
        body: fd
      })
    } catch (err) {
      throw asNetworkError(err)
    }
    if (!res.ok) throw await toCartesiaError(res)
    return mapVoice((await res.json()) as RawVoice)
  }

  /** GET /voices/{id} — один голос (для перевірки існування та доступу) */
  async getVoice(key: string, voiceId: string): Promise<CartesiaVoice & VoiceProFacts> {
    let res: Response
    try {
      res = await this.fetchFn(`${this.base}/voices/${voiceId}`, {
        headers: this.headers(key, false)
      })
    } catch (err) {
      throw asNetworkError(err)
    }
    if (!res.ok) throw await toCartesiaError(res)
    const raw = (await res.json()) as RawVoice
    return {
      ...mapVoice(raw),
      // PVC-факти: Pro Voice Clone має обмеження моделей; сумісні перелічені у fine_tunes
      isPro: Array.isArray(raw.fine_tune) ? raw.fine_tune.length > 0 : !!raw.fine_tune && Object.keys(raw.fine_tune).length > 0,
      compatibleModels: extractCompatibleModels(raw.fine_tune)
    }
  }

  /** PATCH /voices/{id} — оновлення голосу (назва, опис, access) */
  async updateVoice(
    key: string,
    voiceId: string,
    patch: { name?: string; description?: string; access?: 'private' | 'public' }
  ): Promise<CartesiaVoice> {
    let res: Response
    try {
      res = await this.fetchFn(`${this.base}/voices/${voiceId}`, {
        method: 'PATCH',
        headers: this.headers(key),
        body: JSON.stringify(patch)
      })
    } catch (err) {
      throw asNetworkError(err)
    }
    if (!res.ok) throw await toCartesiaError(res)
    return mapVoice((await res.json()) as RawVoice)
  }

  /** GET /accents — валідні значення для clone.accent */
  async getAccents(key: string): Promise<string[]> {
    let res: Response
    try {
      res = await this.fetchFn(`${this.base}/accents?limit=100`, {
        headers: this.headers(key, false)
      })
    } catch (err) {
      throw asNetworkError(err)
    }
    if (!res.ok) throw await toCartesiaError(res)
    const body = (await res.json()) as { data?: Array<{ id?: string; name?: string }> | string[] }
    if (Array.isArray(body)) return body as string[]
    return (body.data ?? [])
      .map((a) => (typeof a === 'string' ? a : a.id ?? a.name ?? ''))
      .filter(Boolean)
  }

  /** POST /voices/localize — копія голосу іншою мовою */
  async localizeVoice(
    key: string,
    opts: { voiceId: string; name: string; language: string; originalSpeakerGender: 'male' | 'female'; description?: string }
  ): Promise<CartesiaVoice> {
    let res: Response
    try {
      res = await this.fetchFn(`${this.base}/voices/localize`, {
        method: 'POST',
        headers: this.headers(key),
        body: JSON.stringify({
          voice_id: opts.voiceId,
          name: opts.name,
          language: opts.language,
          original_speaker_gender: opts.originalSpeakerGender,
          description: opts.description ?? ''
        })
      })
    } catch (err) {
      throw asNetworkError(err)
    }
    if (!res.ok) throw await toCartesiaError(res)
    return mapVoice((await res.json()) as RawVoice)
  }

  /** DELETE /voices/{id} */
  async deleteVoice(key: string, voiceId: string): Promise<void> {
    let res: Response
    try {
      res = await this.fetchFn(`${this.base}/voices/${voiceId}`, {
        method: 'DELETE',
        headers: this.headers(key, false)
      })
    } catch (err) {
      throw asNetworkError(err)
    }
    if (!res.ok && res.status !== 204) throw await toCartesiaError(res)
  }

  /** Завантаження оригінального семплу голосу (потрібна авторизація — перевірено емпірично) */
  async fetchPreview(key: string, url: string): Promise<{ data: Buffer; contentType: string }> {
    let res: Response
    try {
      res = await this.fetchFn(url, { headers: this.headers(key, false) })
    } catch (err) {
      throw asNetworkError(err)
    }
    if (!res.ok) throw new CartesiaError('unknown', `Превʼю недоступне: HTTP ${res.status}`)
    return {
      data: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get('content-type') ?? 'audio/mpeg'
    }
  }
}
