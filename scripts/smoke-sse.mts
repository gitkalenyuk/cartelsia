// Реальна перевірка /tts/sse + word timestamps + генерація SRT (~30 кредитів).
// Використовує БОЙОВИЙ код парсера і субтитрів (Node 25 виконує TS напряму).
import { readFileSync } from 'fs'
import { parseSse } from '../src/main/cartesia/sse.ts'
import { buildSubtitles } from '../src/main/subtitles/srt.ts'
import type { Chat } from '../src/shared/types.ts'

const TRANSCRIPT = 'Субтитри працюють чудово.'
if (TRANSCRIPT.length > 200) throw new Error('бюджетний запобіжник')

const { keys } = JSON.parse(readFileSync('keys.local.json', 'utf8')) as { keys: string[] }

const voicesRes = await fetch('https://api.cartesia.ai/voices/?limit=1&language=uk', {
  headers: { Authorization: `Bearer ${keys[1]}`, 'Cartesia-Version': '2026-03-01' }
})
const voiceId = ((await voicesRes.json()) as { data: { id: string }[] }).data[0]?.id
if (!voiceId) throw new Error('немає uk-голосу')

const res = await fetch('https://api.cartesia.ai/tts/sse', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${keys[1]}`,
    'Cartesia-Version': '2026-03-01',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model_id: 'sonic-3.5',
    transcript: TRANSCRIPT,
    voice: { mode: 'id', id: voiceId },
    language: 'uk',
    output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: 44100 },
    add_timestamps: true
  })
})
if (!res.ok || !res.body) throw new Error(`SSE HTTP ${res.status}: ${await res.text()}`)

let pcmBytes = 0
const words: string[] = []
const start: number[] = []
const end: number[] = []
const seenTypes = new Set<string>()

for await (const event of parseSse(res.body)) {
  seenTypes.add(String(event.type))
  if (event.type === 'chunk' && typeof event.data === 'string') {
    pcmBytes += Buffer.from(event.data, 'base64').length
  } else if (event.type === 'timestamps' && event.word_timestamps) {
    const wt = event.word_timestamps as { words: string[]; start: number[]; end: number[] }
    words.push(...wt.words)
    start.push(...wt.start)
    end.push(...wt.end)
  } else if (event.type === 'error') {
    throw new Error(`SSE error event: ${JSON.stringify(event)}`)
  } else if (event.type === 'done') break
}

console.log(`типи подій: ${[...seenTypes].join(', ')}`)
console.log(`PCM: ${pcmBytes} байтів (~${(pcmBytes / (44100 * 2)).toFixed(1)} c)`)
console.log(`слова (${words.length}): ${words.join(' | ')}`)
if (pcmBytes < 10_000) throw new Error('замало PCM')
if (words.length < 2) throw new Error('замало таймкодів слів')
if (end[end.length - 1] <= start[0]) throw new Error('таймкоди не зростають')

// SRT із бойового генератора
const chat = {
  id: 'x',
  title: 'x',
  createdAt: new Date().toISOString(),
  sourceText: TRANSCRIPT,
  settings: { silenceMs: 300 } as Chat['settings'],
  status: 'done',
  chunks: [
    {
      id: 'c1',
      index: 0,
      text: TRANSCRIPT,
      status: 'done',
      attempts: 0,
      selectedVersionId: 'v1',
      versions: [
        {
          id: 'v1',
          createdAt: '',
          keyId: '',
          keyLabel: '',
          settings: {} as Chat['chunks'][0]['versions'][0]['settings'],
          textSnapshot: TRANSCRIPT,
          file: '',
          format: 'wav' as const,
          durationSec: pcmBytes / (44100 * 2),
          timestamps: { words, start, end }
        }
      ]
    }
  ]
} satisfies Chat

const srt = buildSubtitles(chat, 'srt')
console.log('--- SRT ---')
console.log(srt)
if (!/^1\r?\n\d\d:\d\d:\d\d,\d\d\d --> \d\d:\d\d:\d\d,\d\d\d/.test(srt))
  throw new Error('SRT-формат некоректний')

console.log('SSE + таймкоди + SRT: УСЕ ПРАЦЮЄ')
