import { readdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { Chat, ChatSummary, Chunk, ChunkVersion } from '../../shared/types'
import { chatDir, dataDir } from '../paths'
import { saveJson, saveJsonDebounced } from './jsonStore'

export class ChatStore {
  private cache = new Map<string, Chat>()

  private chatFile(chatId: string): string {
    return join(chatDir(chatId), 'chat.json')
  }

  list(): ChatSummary[] {
    const root = join(dataDir(), 'chats')
    const out: ChatSummary[] = []
    for (const id of readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)) {
      const chat = this.get(id)
      if (!chat) continue
      out.push({
        id: chat.id,
        title: chat.title,
        createdAt: chat.createdAt,
        status: chat.status,
        chunkCount: chat.chunks.length,
        doneCount: chat.chunks.filter((c) => c.status === 'done').length
      })
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  get(chatId: string): Chat | null {
    const cached = this.cache.get(chatId)
    if (cached) return cached
    const file = this.chatFile(chatId)
    if (!existsSync(file)) return null
    try {
      const chat = JSON.parse(readFileSync(file, 'utf8')) as Chat
      // після рестарту «підвислі» статуси скидаються в pending
      for (const chunk of chat.chunks) {
        if (chunk.status === 'running' || chunk.status === 'waiting-key') chunk.status = 'pending'
      }
      if (chat.status === 'running') chat.status = 'paused'
      this.cache.set(chatId, chat)
      return chat
    } catch (err) {
      console.error(`[chatStore] failed to load ${chatId}:`, err)
      return null
    }
  }

  create(chat: Chat): Chat {
    this.cache.set(chat.id, chat)
    saveJson(this.chatFile(chat.id), chat)
    return chat
  }

  /** Дебаунс-збереження: часті оновлення статусів не молотять диск */
  save(chat: Chat, immediate = false): void {
    this.cache.set(chat.id, chat)
    if (immediate) saveJson(this.chatFile(chat.id), chat)
    else saveJsonDebounced(this.chatFile(chat.id), () => this.cache.get(chat.id) ?? chat)
  }

  delete(chatId: string): void {
    this.cache.delete(chatId)
    rmSync(join(dataDir(), 'chats', chatId), { recursive: true, force: true })
  }

  /** Зберігає аудіо версії чанка на диск і реєструє версію */
  addVersion(
    chat: Chat,
    chunk: Chunk,
    audio: Buffer,
    version: Omit<ChunkVersion, 'file'>
  ): ChunkVersion {
    const ext = version.format
    const fileName = `${chunk.id}.${version.id}.${ext}`
    const abs = join(chatDir(chat.id), 'audio', fileName)
    writeFileSync(abs, audio)
    const full: ChunkVersion = { ...version, file: `audio/${fileName}` }
    chunk.versions.push(full)
    chunk.selectedVersionId = full.id
    chunk.textEditedAfterVoice = false
    this.save(chat)
    return full
  }

  audioPath(chatId: string, relFile: string): string {
    return join(chatDir(chatId), relFile)
  }
}
