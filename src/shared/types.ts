// Спільні типи для main / preload / renderer

// ---------- Ключі ----------
export type KeyStatus = 'active' | 'frozen' | 'invalid'
export type FreezeReason = 'low-remaining' | 'quota_exceeded'
/** pool — звичайний ключ для генерацій; clone — ключ акаунта з клон-голосом (не бере участі в загальному пулі) */
export type KeyRole = 'pool' | 'clone'

export interface ApiKey {
  id: string
  key: string // sk_car_... (зберігається у відкритому JSON — рішення користувача)
  label: string
  usedChars: number // локальний лічильник: API не віддає залишок кредитів
  limit: number // 20000 за замовчуванням, per-key override
  status: KeyStatus
  role?: KeyRole // відсутнє = 'pool' (сумісність зі старими keys.json)
  frozenAt?: string
  frozenUntil?: string
  freezeReason?: FreezeReason
  createdAt: string
  lastValidatedAt?: string
}

/** Ключ без секрету — для передачі в renderer */
export interface ApiKeyPublic extends Omit<ApiKey, 'key'> {
  keyMasked: string // sk_car_…A1B2
  activeSlots: number
  remaining: number
}

export interface AddKeysResult {
  added: ApiKeyPublic[]
  rejected: { key: string; reason: 'invalid' | 'duplicate' | 'format' }[]
}

// ---------- Налаштування генерації ----------
export type ModelId = 'sonic-3.5' | 'sonic-3'
export type AudioContainer = 'mp3' | 'wav'

export interface OutputFormatSetting {
  container: AudioContainer
  sampleRate: 8000 | 16000 | 22050 | 24000 | 44100 | 48000
  bitRate?: 32000 | 64000 | 96000 | 128000 | 192000 // тільки mp3
}

export interface GenerationSettings {
  modelId: ModelId
  voiceId: string
  voiceName?: string
  voiceOwningKeyId?: string // для клон-голосів: чанки йдуть тільки через цей ключ
  language?: string // 'uk' і т.д.; undefined → автовизначення
  speed?: number // [0.6, 1.5]
  volume?: number // [0.5, 2.0]
  emotion?: string
  chunkSize: number // 500 за замовчуванням
  output: OutputFormatSetting
  subtitleMode: boolean // true → /tts/sse + word timestamps, збереження WAV
  silenceMs: number // тиша між чанками при склейці
  autoMerge: boolean
}

// ---------- Чати ----------
export type ChunkStatus =
  | 'pending'
  | 'waiting-key'
  | 'running'
  | 'done'
  | 'failed'
  | 'blocked'
  | 'cancelled'

export interface WordTimestamps {
  words: string[]
  start: number[]
  end: number[]
}

export interface ChunkVersion {
  id: string
  createdAt: string
  keyId: string
  keyLabel: string
  settings: Pick<
    GenerationSettings,
    'modelId' | 'voiceId' | 'voiceName' | 'language' | 'speed' | 'volume' | 'emotion' | 'subtitleMode'
  >
  textSnapshot: string
  file: string // відносно папки чату: audio/<chunkId>.<versionId>.mp3|wav
  format: AudioContainer
  durationSec?: number
  timestamps?: WordTimestamps
}

export interface ChunkError {
  errorCode?: string
  message: string
  requestId?: string
}

export interface Chunk {
  id: string
  index: number
  text: string
  status: ChunkStatus
  attempts: number
  runningKeyLabel?: string
  lastError?: ChunkError
  versions: ChunkVersion[]
  selectedVersionId?: string
  textEditedAfterVoice?: boolean
}

export type ChatStatus = 'draft' | 'running' | 'paused' | 'done' | 'partial' | 'cancelled'

export interface Chat {
  id: string
  title: string
  createdAt: string
  sourceText: string
  settings: GenerationSettings
  chunks: Chunk[]
  status: ChatStatus
  mergedFilePath?: string
}

export interface ChatSummary {
  id: string
  title: string
  createdAt: string
  status: ChatStatus
  chunkCount: number
  doneCount: number
}

// ---------- Оцінка перед стартом ----------
export interface KeyAllocation {
  keyId: string
  keyLabel: string
  chunkCount: number
  chars: number
  remainingAfter: number
}

export interface PreflightEstimate {
  totalChars: number
  chunkCount: number
  poolRemaining: number
  feasible: boolean
  fittableChunks: number
  allocations: KeyAllocation[]
  blockedChunks: { index: number; reason: string }[]
}

// ---------- Голоси ----------
export interface CartesiaVoice {
  id: string
  name: string
  description?: string
  language: string
  gender?: string
  isOwner: boolean
  isPublic: boolean
  previewUrl?: string
  createdAt?: string
}

export interface VoiceFavorite {
  id: string
  name: string
  language: string
  gender?: string
  description?: string
  previewUrl?: string
  addedAt: string
}

export interface ClonedVoiceMeta {
  id: string
  name: string
  language: string
  description?: string
  owningKeyId: string
  owningKeyLabel: string
  clonedAt: string
  localizedFrom?: string
  /** 2.0.1: клон створено через Master Pro-ключ (власник — мастер-акаунт) */
  viaMaster?: boolean
  /** 2.0.1: голос зроблено публічним (доступний іншим ключам) */
  isPublic?: boolean
}

// ---------- Master-клонування (2.0.1) ----------

/** Статус master-ключа: чи заданий, валідний, тариф */
export interface MasterStatus {
  configured: boolean
  valid?: boolean
  plan?: 'free' | 'pro' | 'startup' | 'scale' | 'unknown'
  error?: string
}

/** Результат master-клонування з дедуплікацією */
export interface MasterCloneResult {
  voice: CartesiaVoice
  /** true — аудіо вже було заклоновано раніше, повернено існуючий голос */
  reused: boolean
  /** true — access перекладено на public після клонування */
  madePublic: boolean
}

// ---------- Статистика ----------
export interface UsageEvent {
  ts: string
  keyId: string
  chatId?: string
  chunkId?: string
  chars: number
  kind: 'tts' | 'probe'
}

export interface UsageStatDay {
  day: string // YYYY-MM-DD
  perKey: Record<string, number>
  total: number
}

export interface StatsSummary {
  totalChars: number
  monthChars: number
  activeKeys: number
  avgPerDay: number
  days: UsageStatDay[]
  keyLabels: Record<string, string>
}

// ---------- Налаштування додатку ----------
export interface ImapConfig {
  host: string
  port: number
  user: string
  pass: string
  tls: boolean
}

export type CaptchaProvider = 'manual' | '2captcha' | 'capsolver'

export type AutoregEngine = 'browser-signup' | 'playwright' | 'browserless' | 'clerk-api'

export interface AutoregSettings {
  engine?: AutoregEngine // default 'browser-signup' (2.0); інші — legacy
  concurrency?: number // одночасних потоків, 1 = підряд, max 50
  captchaProvider?: CaptchaProvider // default 'manual'
  captchaApiKey?: string
  delayMs?: number // пауза між акаунтами (мс), default ~2500-5500
  batchSize?: number // розмір пачки, undefined = без пачок
  chromiumMode?: 'bundled' | 'download' // bundled=все в .exe, download=докачка при першому запуску
  headless?: boolean // headless Chromium (default true)
  useProxy?: boolean // ганяти реєстрацію через проксі-пул
}

export interface ProxyEntry {
  url: string
  status: 'unchecked' | 'working' | 'dead'
  lastChecked?: string
  latencyMs?: number
}

export interface ProxySettings {
  grabUrl?: string
  proxies?: string[]
}

export interface Settings {
  grabUrl?: string
  proxies?: string[]
}

export interface Settings {
  defaults: GenerationSettings
  globalConcurrencyCap?: number // undefined → авто (2 × активні ключі)
  notifySystem: boolean
  notifySound: boolean
  outputDirOverride?: string
  catchAllDomain?: string
  imapConfig?: ImapConfig
  autoreg?: AutoregSettings
  proxy?: ProxySettings
  /** 2.0.1: API-ключ Master-акаунта з Pro-підпискою — для клонування голосів через API */
  masterApiKey?: string
  /** 2.0.1: автоматично робити нові мастер-клони публічними (щоб юзати з free-ключів) */
  masterAutoPublic?: boolean
  /**
   * 2.0.1: ліміт паралельних запитів на майстер-ключі (Tarif: Free 2, Pro 3, Startup 5, Scale 15).
   * undefined → 3 (Pro за замовчуванням)
   */
  masterConcurrency?: number
}

export interface AppPaths {
  dataDir: string
  outputDir: string
  portable: boolean
}

// ---------- Автореєстрація ----------
export type AutoregState =
  | 'queued'
  | 'form'
  | 'waiting-mail'
  | 'verifying'
  | 'creating-key'
  | 'done'
  | 'failed'
  | 'cancelled'

export interface AutoregItem {
  id: string
  email: string
  pass: string
  state: AutoregState
  key?: string
  error?: string
}

// ---------- Події main → renderer ----------
export interface QueueStateSnapshot {
  chatId: string
  state: 'running' | 'paused' | 'done' | 'cancelled' | 'idle'
  total: number
  done: number
  failed: number
  charsUsed: number
  charsTotal: number
}

export type MainEvent =
  | { type: 'key-updated'; key: ApiKeyPublic }
  | { type: 'keys-replaced'; keys: ApiKeyPublic[] }
  | { type: 'queue-state'; snapshot: QueueStateSnapshot }
  | {
      type: 'chunk-status'
      chatId: string
      chunkId: string
      chunk: Chunk
    }
  | {
      type: 'scheduler-paused'
      chatId: string
      reason: 'no-keys' | 'all-frozen' | 'user'
      resumeAt?: string
    }
  | { type: 'queue-finished'; chatId: string; ok: number; failed: number; chars: number }
  | { type: 'merge-requested'; chatId: string }
  | { type: 'chat-updated'; chat: Chat }
  | { type: 'autoreg-captcha'; email: string; message: string }
  | { type: 'autoreg-progress'; items: AutoregItem[]; current: number; total: number }
  | { type: 'autoreg-done'; items: AutoregItem[] }
  | { type: 'autoreg-item-done'; item: AutoregItem; index: number }
  | { type: 'autoreg-log'; line: string }
  // 2.0.1 master-клонування
  | { type: 'master-log'; line: string }

// ---------- Дефолти ----------
export const DEFAULT_KEY_LIMIT = 20000
export const FREEZE_THRESHOLD = 100 // remaining < 100 → заморозка
export const PER_KEY_CONCURRENCY = 2 // жорсткий ліміт Cartesia для безкоштовних ключів
export const MAX_ATTEMPTS = 3
export const CARTESIA_VERSION = '2026-03-01'
export const CARTESIA_BASE = 'https://api.cartesia.ai'

export const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  modelId: 'sonic-3.5',
  voiceId: '',
  chunkSize: 500,
  output: { container: 'mp3', sampleRate: 44100, bitRate: 128000 },
  subtitleMode: false,
  silenceMs: 300,
  autoMerge: false
}

export const DEFAULT_SETTINGS: Settings = {
  defaults: DEFAULT_GENERATION_SETTINGS,
  notifySystem: true,
  notifySound: true
}

export const SUPPORTED_LANGUAGES = [
  'uk', 'en', 'fr', 'de', 'es', 'pt', 'zh', 'ja', 'hi', 'it', 'ko', 'nl', 'pl', 'ru',
  'sv', 'tr', 'tl', 'bg', 'ro', 'ar', 'cs', 'el', 'fi', 'hr', 'ms', 'sk', 'da', 'ta',
  'hu', 'no', 'vi', 'bn', 'th', 'he', 'ka', 'id', 'te', 'gu', 'kn', 'ml', 'mr', 'pa'
] as const

export const EMOTIONS_PRIMARY = ['neutral', 'calm', 'angry', 'content', 'sad', 'scared'] as const
