import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * Кеш TTS-генерацій (2.1): однаковий запит = той самий wav з диска, без API.
 * TTS коштує ~1 кредит/символ КОЖНОГО разу — відео-пайплайн з переозвучками
 * без кешу спалює кредити марно.
 *
 * Атомарність: пишемо в .tmp → rename. Crash між ними лишає .tmp сміття
 * (ігнориться при читанні), але НІКОЛИ не обріаний «живий» запис.
 */
export class TtsCache {
  private dir: string

  constructor(cacheDir: string) {
    this.dir = cacheDir
    mkdirSync(this.dir, { recursive: true })
  }

  static key(voiceId: string, modelId: string, language: string | undefined, text: string): string {
    return createHash('sha256')
      .update(`${voiceId}|${modelId}|${language ?? ''}|${text}`)
      .digest('hex')
  }

  pathFor(key: string): string {
    return join(this.dir, key.slice(0, 2), `${key}.wav`)
  }

  /** Hit тільки якщо файл існує й більший за WAV-заголовок */
  get(voiceId: string, modelId: string, language: string | undefined, text: string): Buffer | undefined {
    const p = this.pathFor(TtsCache.key(voiceId, modelId, language, text))
    try {
      if (!existsSync(p)) return undefined
      const buf = readFileSync(p)
      if (buf.length <= 44) return undefined
      return buf
    } catch {
      return undefined
    }
  }

  put(voiceId: string, modelId: string, language: string | undefined, text: string, audio: Buffer): void {
    if (audio.length <= 44) return // порожнє не кешуємо
    const key = TtsCache.key(voiceId, modelId, language, text)
    const final = this.pathFor(key)
    const tmp = `${final}.${process.pid}.${Date.now()}.tmp`
    try {
      mkdirSync(join(this.dir, key.slice(0, 2)), { recursive: true })
      writeFileSync(tmp, audio)
      renameSync(tmp, final)
    } catch {
      try { rmSync(tmp, { force: true }) } catch { /* ignore */ }
    }
  }

  /** Публічний шлях для renderer (media:// або пряме читання через IPC) */
  pathOf(voiceId: string, modelId: string, language: string | undefined, text: string): string {
    return this.pathFor(TtsCache.key(voiceId, modelId, language, text))
  }
}
