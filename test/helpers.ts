import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { CartesiaClient } from '../src/main/cartesia/client'
import type { UsageLedger } from '../src/main/persistence/usageLedger'
import type { ChatStore } from '../src/main/persistence/chatStore'
import type { Chat, Chunk, ChunkVersion, GenerationSettings } from '../src/shared/types'
import { DEFAULT_GENERATION_SETTINGS } from '../src/shared/types'

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'cartelsia-test-'))
}

export function mockLedger(): UsageLedger {
  const events: unknown[] = []
  return {
    append: (e: unknown) => events.push(e),
    readAll: () => events,
    dailyStats: () => []
  } as unknown as UsageLedger
}

export function mockClient(overrides: Partial<Record<keyof CartesiaClient, unknown>> = {}): CartesiaClient {
  return {
    validateKey: async () => true,
    ttsBytes: async () => ({ audio: Buffer.from('mp3'), format: 'mp3', sampleRate: 44100 }),
    ttsSseWithTimestamps: async () => ({
      pcm: Buffer.alloc(4410),
      timestamps: { words: [], start: [], end: [] },
      sampleRate: 44100
    }),
    listVoices: async () => ({ data: [], hasMore: false }),
    ...overrides
  } as unknown as CartesiaClient
}

export function mockChatStore(): ChatStore {
  return {
    save: () => undefined,
    get: () => null,
    addVersion: (chat: Chat, chunk: Chunk, _audio: Buffer, version: Omit<ChunkVersion, 'file'>) => {
      const full = { ...version, file: `audio/${chunk.id}.${version.id}.${version.format}` }
      chunk.versions.push(full as ChunkVersion)
      chunk.selectedVersionId = version.id
      return full
    },
    audioPath: () => ''
  } as unknown as ChatStore
}

export function makeChat(chunkTexts: string[], settings: Partial<GenerationSettings> = {}): Chat {
  return {
    id: 'chat-1',
    title: 'test',
    createdAt: new Date().toISOString(),
    sourceText: chunkTexts.join(' '),
    settings: { ...DEFAULT_GENERATION_SETTINGS, voiceId: 'voice-1', ...settings },
    status: 'draft',
    chunks: chunkTexts.map((text, index) => ({
      id: `chunk-${index}`,
      index,
      text,
      status: 'pending' as const,
      attempts: 0,
      versions: []
    }))
  }
}

export function waitFor(
  predicate: () => boolean,
  timeoutMs = 3000,
  intervalMs = 10
): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer)
        resolve()
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer)
        reject(new Error('waitFor timeout'))
      }
    }, intervalMs)
  })
}
