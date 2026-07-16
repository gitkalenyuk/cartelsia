/**
 * Розумна розбивка тексту на чанки:
 * - ніколи не рвемо речення посередині, якщо воно вміщується в ліміт;
 * - абзаци по можливості зберігаються (розрив чанка на межі абзацу);
 * - завелике одне речення ділиться по клаузах (, ; : —), потім по словах;
 * - inline-теги (<break time="500ms"/> тощо) — атомарні токени.
 */

const TAG_RE = /<[^<>]{1,80}\/?>|\[[a-z]+\]/g

function splitSentences(paragraph: string): string[] {
  // Intl.Segmenter коректно працює з кирилицею, скороченнями і «...»
  const seg = new Intl.Segmenter('uk', { granularity: 'sentence' })
  const parts: string[] = []
  for (const { segment } of seg.segment(paragraph)) {
    if (segment.trim()) parts.push(segment)
  }
  return parts.length ? parts : paragraph.trim() ? [paragraph] : []
}

/** Ділимо завелике речення: спершу по клаузах, потім по словах; теги атомарні */
function splitOversized(sentence: string, maxChars: number): string[] {
  const tokens: string[] = []
  let last = 0
  for (const m of sentence.matchAll(TAG_RE)) {
    if (m.index! > last) tokens.push(...sentence.slice(last, m.index).split(/(?<=[,;:—–])\s+|\s+/))
    tokens.push(m[0])
    last = m.index! + m[0].length
  }
  if (last < sentence.length) tokens.push(...sentence.slice(last).split(/(?<=[,;:—–])\s+|\s+/))

  const chunks: string[] = []
  let current = ''
  for (const token of tokens.filter(Boolean)) {
    const candidate = current ? `${current} ${token}` : token
    if (candidate.length > maxChars && current) {
      chunks.push(current)
      current = token
    } else {
      current = candidate
    }
  }
  if (current) chunks.push(current)
  return chunks
}

export function chunkText(text: string, maxChars: number): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []
  const limit = Math.max(50, maxChars)

  const chunks: string[] = []
  let current = ''

  const pushCurrent = (): void => {
    const trimmed = current.trim()
    if (trimmed) chunks.push(trimmed)
    current = ''
  }

  for (const paragraph of normalized.split(/\n{2,}/)) {
    const para = paragraph.trim()
    if (!para) continue

    // якщо цілий абзац влазить у поточний чанк — додаємо; інакше нове накопичення
    if (current && (current.length + para.length + 2) > limit) pushCurrent()

    if (para.length <= limit) {
      current = current ? `${current}\n\n${para}` : para
      continue
    }

    for (const sentence of splitSentences(para)) {
      const s = sentence.trim()
      if (!s) continue
      const pieces = s.length > limit ? splitOversized(s, limit) : [s]
      for (const piece of pieces) {
        const joined = current ? `${current} ${piece}` : piece
        if (joined.length > limit && current) {
          pushCurrent()
          current = piece
        } else {
          current = joined
        }
      }
    }
    // абзац завершено — але не форсуємо розрив: наступний абзац може влізти
  }
  pushCurrent()
  return chunks
}
