import { EventEmitter } from 'events'
import {
  MAX_ATTEMPTS,
  PER_KEY_CONCURRENCY,
  type Chat,
  type Chunk,
  type ChunkVersion,
  type GenerationSettings,
  type MainEvent,
  type QueueStateSnapshot
} from '../../shared/types'
import type { CartesiaClient } from '../cartesia/client'
import type { KeyPool } from '../keys/keyPool'
import type { ChatStore } from '../persistence/chatStore'
import { CartesiaError } from '../cartesia/errors'
import { pcmDurationSec, wrapWav } from '../audio/wav'

interface RuntimeChunkState {
  triedKeys: Set<string>
}

interface JobState {
  chat: Chat
  state: 'running' | 'paused' | 'cancelled' | 'done'
  runtime: Map<string, RuntimeChunkState>
  charsUsed: number
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Черга генерації: паралельний фан-аут чанків по пулу ключів.
 * - семафор 2 слоти на ключ (жорсткий ліміт Cartesia free tier)
 * - best-fit вибір ключа; клон-голоси пришпилені до ключа-власника
 * - quota_exceeded → заморозка ключа + перепризначення чанка (не витрачає спробу)
 * - мережеві/5xx → до 3 спроб із ротацією ключів, потім failed
 */
export class Scheduler extends EventEmitter {
  private jobs = new Map<string, JobState>()
  private globalCap?: number

  constructor(
    private pool: KeyPool,
    private client: CartesiaClient,
    private store: ChatStore
  ) {
    super()
    this.pool.on('keys-available', () => {
      for (const job of this.jobs.values()) {
        if (job.state === 'running') this.pump(job)
      }
    })
  }

  setGlobalCap(cap: number | undefined): void {
    this.globalCap = cap
  }

  private emitEvent(event: MainEvent): void {
    this.emit('event', event)
  }

  private effectiveCap(): number {
    const auto = PER_KEY_CONCURRENCY * this.pool.activeCount()
    return this.globalCap ? Math.min(this.globalCap, auto) : auto
  }

  private snapshot(job: JobState): QueueStateSnapshot {
    const chunks = job.chat.chunks
    return {
      chatId: job.chat.id,
      state: job.state === 'done' ? 'done' : job.state,
      total: chunks.length,
      done: chunks.filter((c) => c.status === 'done').length,
      failed: chunks.filter((c) => c.status === 'failed' || c.status === 'blocked').length,
      charsUsed: job.charsUsed,
      charsTotal: chunks.reduce((s, c) => s + c.text.length, 0)
    }
  }

  private notifyChunk(job: JobState, chunk: Chunk): void {
    this.store.save(job.chat)
    this.emitEvent({ type: 'chunk-status', chatId: job.chat.id, chunkId: chunk.id, chunk })
    this.emitEvent({ type: 'queue-state', snapshot: this.snapshot(job) })
  }

  start(chat: Chat): void {
    let job = this.jobs.get(chat.id)
    if (!job) {
      job = { chat, state: 'running', runtime: new Map(), charsUsed: 0 }
      this.jobs.set(chat.id, job)
    } else {
      job.chat = chat
      job.state = 'running'
    }
    for (const chunk of chat.chunks) {
      if (chunk.status === 'cancelled' || chunk.status === 'waiting-key') chunk.status = 'pending'
      if (!job.runtime.has(chunk.id)) job.runtime.set(chunk.id, { triedKeys: new Set() })
    }
    chat.status = 'running'
    this.store.save(chat, true)
    this.emitEvent({ type: 'queue-state', snapshot: this.snapshot(job) })
    this.pump(job)
  }

  pause(chatId: string): void {
    const job = this.jobs.get(chatId)
    if (!job) return
    job.state = 'paused'
    job.chat.status = 'paused'
    this.store.save(job.chat, true)
    this.emitEvent({ type: 'queue-state', snapshot: this.snapshot(job) })
    this.emitEvent({ type: 'scheduler-paused', chatId, reason: 'user' })
  }

  resume(chatId: string): void {
    const job = this.jobs.get(chatId)
    if (!job) return
    job.state = 'running'
    job.chat.status = 'running'
    this.store.save(job.chat, true)
    this.emitEvent({ type: 'queue-state', snapshot: this.snapshot(job) })
    this.pump(job)
  }

  cancel(chatId: string): void {
    const job = this.jobs.get(chatId)
    if (!job) return
    job.state = 'cancelled'
    for (const chunk of job.chat.chunks) {
      if (chunk.status === 'pending' || chunk.status === 'waiting-key') chunk.status = 'cancelled'
    }
    job.chat.status = 'cancelled'
    this.store.save(job.chat, true)
    this.emitEvent({ type: 'queue-state', snapshot: this.snapshot(job) })
  }

  retryChunk(chatId: string, chunkId: string): void {
    const job = this.jobs.get(chatId)
    if (!job) return
    const chunk = job.chat.chunks.find((c) => c.id === chunkId)
    if (!chunk) return
    chunk.status = 'pending'
    chunk.attempts = 0
    chunk.lastError = undefined
    job.runtime.set(chunkId, { triedKeys: new Set() })
    if (job.state !== 'running') {
      job.state = 'running'
      job.chat.status = 'running'
    }
    this.notifyChunk(job, chunk)
    this.pump(job)
  }

  /** Переозвучка чанка (нова версія) з опційними overrides налаштувань */
  revoiceChunk(chatId: string, chunkId: string, overrides?: Partial<GenerationSettings>): void {
    const chat = this.store.get(chatId)
    if (!chat) return
    let job = this.jobs.get(chatId)
    if (!job) {
      job = { chat, state: 'running', runtime: new Map(), charsUsed: 0 }
      this.jobs.set(chatId, job)
      for (const c of chat.chunks) job.runtime.set(c.id, { triedKeys: new Set() })
    }
    const chunk = job.chat.chunks.find((c) => c.id === chunkId)
    if (!chunk) return
    if (overrides && Object.keys(overrides).length) {
      // overrides застосовуються до налаштувань чату для ЦЬОГО запуску чанка
      job.chat.settings = { ...job.chat.settings, ...overrides }
      this.store.save(job.chat, true)
    }
    chunk.status = 'pending'
    chunk.attempts = 0
    chunk.lastError = undefined
    job.runtime.set(chunkId, { triedKeys: new Set() })
    if (job.state !== 'running') job.state = 'running'
    this.notifyChunk(job, chunk)
    this.pump(job)
  }

  isRunning(chatId: string): boolean {
    return this.jobs.get(chatId)?.state === 'running'
  }

  private totalInFlight(): number {
    let n = 0
    for (const job of this.jobs.values()) {
      n += job.chat.chunks.filter((c) => c.status === 'running').length
    }
    return n
  }

  private pump(job: JobState): void {
    if (job.state !== 'running') return

    for (const chunk of job.chat.chunks) {
      if (chunk.status !== 'pending' && chunk.status !== 'waiting-key') continue

      let runtime = job.runtime.get(chunk.id)
      if (!runtime) {
        runtime = { triedKeys: new Set() }
        job.runtime.set(chunk.id, runtime)
      }
      const cost = chunk.text.length
      const pinned = job.chat.settings.voiceOwningKeyId

      // жоден активний ключ не вміщує → чекаємо розморозки або блокуємо назавжди
      if (!this.pool.anyActiveKeyFits(cost, pinned)) {
        const next: Chunk['status'] = this.pool.anyKeyCouldEver(cost, pinned)
          ? 'waiting-key'
          : 'blocked'
        if (chunk.status !== next) {
          chunk.status = next
          if (next === 'blocked') {
            chunk.lastError = {
              message: pinned
                ? 'Ключ-власник клон-голосу не може вмістити цей фрагмент'
                : 'Жоден ключ не вміщує цей фрагмент (завеликий для лімітів)'
            }
          }
          this.notifyChunk(job, chunk)
        }
        continue
      }

      // ключ знайдеться — але чи є глобальна ємність?
      if (this.totalInFlight() >= this.effectiveCap()) break

      let candidates = this.pool.candidatesFor(cost, pinned, runtime.triedKeys)
      if (!candidates.length && runtime.triedKeys.size) {
        // всі ключі вже пробувались цим чанком → дозволяємо повторне коло
        runtime.triedKeys.clear()
        candidates = this.pool.candidatesFor(cost, pinned)
      }
      if (!candidates.length) continue // слоти зайняті — диспатч при звільненні

      const key = candidates[0]
      if (!this.pool.acquireSlot(key.id)) continue
      if (chunk.status === 'waiting-key') chunk.status = 'pending'
      runtime.triedKeys.add(key.id)
      void this.dispatch(job, chunk, key.id)
    }

    this.checkIdle(job)
  }

  private checkIdle(job: JobState): void {
    const chunks = job.chat.chunks
    const anyRunning = chunks.some((c) => c.status === 'running')
    const anyPending = chunks.some((c) => c.status === 'pending')
    const anyWaiting = chunks.some((c) => c.status === 'waiting-key')

    if (anyRunning || anyPending) return

    if (anyWaiting && job.state === 'running') {
      this.emitEvent({
        type: 'scheduler-paused',
        chatId: job.chat.id,
        reason: this.pool.activeCount() === 0 ? 'all-frozen' : 'no-keys',
        resumeAt: this.pool.earliestUnfreeze()
      })
      return
    }

    if (job.state === 'running') {
      // завершено
      job.state = 'done'
      const ok = chunks.filter((c) => c.status === 'done').length
      const failed = chunks.filter((c) => c.status === 'failed' || c.status === 'blocked').length
      job.chat.status = failed === 0 ? 'done' : 'partial'
      this.store.save(job.chat, true)
      this.emitEvent({ type: 'queue-state', snapshot: this.snapshot(job) })
      this.emitEvent({
        type: 'queue-finished',
        chatId: job.chat.id,
        ok,
        failed,
        chars: job.charsUsed
      })
      if (job.chat.settings.autoMerge && failed === 0 && ok > 0) {
        this.emitEvent({ type: 'merge-requested', chatId: job.chat.id })
      }
    }
  }

  private async dispatch(job: JobState, chunk: Chunk, keyId: string): Promise<void> {
    const rawKey = this.pool.getRaw(keyId)
    if (!rawKey) {
      this.pool.releaseSlot(keyId)
      chunk.status = 'pending'
      this.pump(job)
      return
    }

    chunk.status = 'running'
    chunk.runningKeyLabel = rawKey.label
    this.notifyChunk(job, chunk)

    const settings = job.chat.settings
    const cost = chunk.text.length

    try {
      let audio: Buffer
      let format: 'mp3' | 'wav'
      let durationSec: number | undefined
      let timestamps: Chunk['versions'][number]['timestamps']

      if (settings.subtitleMode) {
        const res = await this.client.ttsSseWithTimestamps(rawKey.key, chunk.text, settings)
        const wavOpts = { sampleRate: res.sampleRate, channels: 1, bitsPerSample: 16 as const }
        audio = wrapWav(res.pcm, wavOpts)
        format = 'wav'
        durationSec = pcmDurationSec(res.pcm.length, wavOpts)
        timestamps = res.timestamps
      } else {
        const res = await this.client.ttsBytes(rawKey.key, chunk.text, settings)
        audio = res.audio
        format = res.format
        // стрімлений MP3 без Xing-заголовка не дає duration у <audio> — рахуємо з CBR-бітрейту
        if (format === 'mp3') {
          durationSec = (audio.length * 8) / (settings.output.bitRate ?? 128000)
        } else {
          durationSec = pcmDurationSec(Math.max(0, audio.length - 44), {
            sampleRate: settings.output.sampleRate,
            channels: 1,
            bitsPerSample: 16
          })
        }
      }

      const version: Omit<ChunkVersion, 'file'> = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        keyId,
        keyLabel: rawKey.label,
        settings: {
          modelId: settings.modelId,
          voiceId: settings.voiceId,
          voiceName: settings.voiceName,
          language: settings.language,
          speed: settings.speed,
          volume: settings.volume,
          emotion: settings.emotion,
          subtitleMode: settings.subtitleMode
        },
        textSnapshot: chunk.text,
        format,
        durationSec,
        timestamps
      }
      this.store.addVersion(job.chat, chunk, audio, version)
      this.pool.recordUsage(keyId, cost, { chatId: job.chat.id, chunkId: chunk.id })
      job.charsUsed += cost
      chunk.status = 'done'
      chunk.runningKeyLabel = undefined
      chunk.lastError = undefined
      this.notifyChunk(job, chunk)
    } catch (err) {
      chunk.runningKeyLabel = undefined
      const cerr = err instanceof CartesiaError ? err : new CartesiaError('unknown', String(err))

      if (cerr.kind === 'quota_exceeded') {
        // ліміт ключа реально вичерпано: заморожуємо, чанк — іншому ключу (спроба не витрачається)
        this.pool.freeze(keyId, 'quota_exceeded')
        chunk.status = 'pending'
      } else if (cerr.kind === 'concurrency_limited') {
        // не мало б статись під семафором — backoff і повтор, спроба не витрачається
        const runtime = job.runtime.get(chunk.id)!
        runtime.triedKeys.delete(keyId)
        await sleep(500 + Math.random() * 1000)
        chunk.status = 'pending'
      } else if (cerr.kind === 'auth') {
        this.pool.markInvalid(keyId)
        chunk.status = 'pending'
      } else {
        chunk.attempts += 1
        if (chunk.attempts >= MAX_ATTEMPTS) {
          chunk.status = 'failed'
          chunk.lastError = {
            errorCode: cerr.errorCode,
            message: cerr.message,
            requestId: cerr.requestId
          }
        } else {
          chunk.status = 'pending'
          chunk.lastError = {
            errorCode: cerr.errorCode,
            message: cerr.message,
            requestId: cerr.requestId
          }
        }
      }
      this.notifyChunk(job, chunk)
    } finally {
      this.pool.releaseSlot(keyId)
      this.pump(job)
    }
  }
}
