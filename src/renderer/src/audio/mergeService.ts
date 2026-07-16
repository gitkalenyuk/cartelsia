import type { Chat } from '@shared/types'
import { toast } from '../stores/appStore'
import { t } from '../i18n/uk'
import LameWorker from './lame.worker?worker'

export interface MergeOptions {
  silenceMs: number
  format: 'mp3' | 'wav'
  bitrateKbps: number
  sampleRate: number
}

/** WAV-заголовок для Int16 PCM */
function wavHeader(dataLen: number, sampleRate: number, channels: number): ArrayBuffer {
  const buf = new ArrayBuffer(44)
  const view = new DataView(buf)
  const writeStr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataLen, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, (sampleRate * channels * 16) / 8, true)
  view.setUint16(32, (channels * 16) / 8, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, dataLen, true)
  return buf
}

function floatToInt16(f32: Float32Array): Int16Array {
  const out = new Int16Array(f32.length)
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

function encodeMp3(samples: Int16Array, sampleRate: number, kbps: number): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const worker = new LameWorker()
    worker.onmessage = (e: MessageEvent<{ ok: boolean; data?: ArrayBuffer; error?: string }>) => {
      worker.terminate()
      if (e.data.ok && e.data.data) resolve(e.data.data)
      else reject(new Error(e.data.error ?? 'MP3 encode failed'))
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(e.message))
    }
    worker.postMessage({ samples, sampleRate, kbps }, [samples.buffer])
  })
}

/**
 * Склейка обраних версій чанків у один файл.
 * decodeAudioData уніфіковано читає mp3 і wav; тиша — нулі в PCM.
 */
export async function mergeChat(chat: Chat, opts: MergeOptions): Promise<ArrayBuffer> {
  const parts: Float32Array[] = []
  const ctx = new OfflineAudioContext(1, 1, opts.sampleRate)

  for (const chunk of [...chat.chunks].sort((a, b) => a.index - b.index)) {
    if (chunk.status !== 'done') continue
    const version =
      chunk.versions.find((v) => v.id === chunk.selectedVersionId) ??
      chunk.versions[chunk.versions.length - 1]
    if (!version) continue

    const bytes = await window.cartelsia.audio.readChunk(chat.id, version.file)
    if (!bytes || bytes.byteLength === 0)
      throw new Error(`Не вдалося прочитати аудіо фрагмента #${chunk.index + 1}`)
    const decoded = await ctx.decodeAudioData(bytes)

    // моно-мікс + ресемпл до цільової частоти, якщо потрібно
    let mono: Float32Array
    if (decoded.numberOfChannels === 1) {
      mono = decoded.getChannelData(0)
    } else {
      const a = decoded.getChannelData(0)
      const b = decoded.getChannelData(1)
      mono = new Float32Array(a.length)
      for (let i = 0; i < a.length; i++) mono[i] = (a[i] + b[i]) / 2
    }
    if (decoded.sampleRate !== opts.sampleRate) {
      const ratio = opts.sampleRate / decoded.sampleRate
      const resampled = new Float32Array(Math.round(mono.length * ratio))
      for (let i = 0; i < resampled.length; i++) {
        const src = i / ratio
        const lo = Math.floor(src)
        const hi = Math.min(lo + 1, mono.length - 1)
        const frac = src - lo
        resampled[i] = mono[lo] * (1 - frac) + mono[hi] * frac
      }
      mono = resampled
    }
    parts.push(mono)
  }

  if (!parts.length) throw new Error('Немає готових фрагментів для обʼєднання')

  const gapSamples = Math.round((opts.silenceMs / 1000) * opts.sampleRate)
  const totalLen =
    parts.reduce((s, p) => s + p.length, 0) + gapSamples * Math.max(0, parts.length - 1)
  const joined = new Float32Array(totalLen)
  let offset = 0
  parts.forEach((p, i) => {
    if (i > 0) offset += gapSamples
    joined.set(p, offset)
    offset += p.length
  })

  const int16 = floatToInt16(joined)
  if (opts.format === 'wav') {
    const header = wavHeader(int16.byteLength, opts.sampleRate, 1)
    const out = new Uint8Array(44 + int16.byteLength)
    out.set(new Uint8Array(header), 0)
    out.set(new Uint8Array(int16.buffer), 44)
    return out.buffer
  }
  return encodeMp3(int16, opts.sampleRate, opts.bitrateKbps)
}

export function suggestedMergeName(chat: Chat, format: 'mp3' | 'wav'): string {
  const date = new Date().toISOString().slice(0, 10)
  const base = chat.title
    .replace(/[<>:"/\\|?*]/g, '')
    .trim()
    .slice(0, 40)
  return `${base || 'cartelsia'}-${date}.${format}`
}

/** Авто-мердж після завершення черги (подія merge-requested) */
export async function runAutoMerge(chatId: string): Promise<void> {
  try {
    const chat = await window.cartelsia.chats.get(chatId)
    if (!chat) return
    const format = chat.settings.output.container
    const data = await mergeChat(chat, {
      silenceMs: chat.settings.silenceMs,
      format,
      bitrateKbps: (chat.settings.output.bitRate ?? 128000) / 1000,
      sampleRate: chat.settings.output.sampleRate
    })
    const res = await window.cartelsia.audio.saveMerged(
      chatId,
      data,
      format,
      suggestedMergeName(chat, format)
    )
    if (res.path) {
      const path = res.path
      toast('success', t.fileSaved, {
        label: t.showInFolder,
        onClick: () => void window.cartelsia.audio.reveal(path)
      })
    }
  } catch (err) {
    toast('danger', t.errorPrefix(err instanceof Error ? err.message : String(err)))
  }
}
