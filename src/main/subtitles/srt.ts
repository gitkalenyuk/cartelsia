import type { Chat, WordTimestamps } from '../../shared/types'

interface Cue {
  start: number
  end: number
  text: string
}

function fmtTime(sec: number, sepMs: ',' | '.'): string {
  const ms = Math.max(0, Math.round(sec * 1000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const rest = ms % 1000
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}${sepMs}${pad(rest, 3)}`
}

/** Групуємо слова у репліки: ~7 слів або пауза ≥ 0.8 с */
function groupWords(ts: WordTimestamps, offset: number): Cue[] {
  const cues: Cue[] = []
  let words: string[] = []
  let start = 0
  let end = 0

  const flush = (): void => {
    if (words.length) cues.push({ start: start + offset, end: end + offset, text: words.join(' ') })
    words = []
  }

  for (let i = 0; i < ts.words.length; i++) {
    if (!words.length) start = ts.start[i]
    const gap = words.length ? ts.start[i] - end : 0
    if (words.length >= 7 || gap >= 0.8) {
      flush()
      start = ts.start[i]
    }
    words.push(ts.words[i])
    end = ts.end[i]
  }
  flush()
  return cues
}

export class SubtitleError extends Error {
  missingChunks: number[]
  constructor(missingChunks: number[]) {
    super('Не всі фрагменти мають таймкоди (потрібен субтитр-режим)')
    this.missingChunks = missingChunks
  }
}

/**
 * Будує SRT/VTT: проходить обрані версії чанків по порядку,
 * зсуваючи таймкоди на суму тривалостей попередніх чанків + тиша між ними.
 */
export function buildSubtitles(chat: Chat, format: 'srt' | 'vtt'): string {
  const missing: number[] = []
  const cues: Cue[] = []
  let offset = 0

  for (const chunk of chat.chunks) {
    if (chunk.status !== 'done') continue
    const version = chunk.versions.find((v) => v.id === chunk.selectedVersionId)
    if (!version) continue
    if (!version.timestamps || version.durationSec === undefined) {
      missing.push(chunk.index + 1)
      continue
    }
    cues.push(...groupWords(version.timestamps, offset))
    offset += version.durationSec + chat.settings.silenceMs / 1000
  }

  if (missing.length) throw new SubtitleError(missing)

  if (format === 'vtt') {
    const body = cues
      .map((c) => `${fmtTime(c.start, '.')} --> ${fmtTime(c.end, '.')}\n${c.text}`)
      .join('\n\n')
    return `WEBVTT\n\n${body}\n`
  }
  return (
    cues
      .map((c, i) => `${i + 1}\n${fmtTime(c.start, ',')} --> ${fmtTime(c.end, ',')}\n${c.text}`)
      .join('\n\n') + '\n'
  )
}
