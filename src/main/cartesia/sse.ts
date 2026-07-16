export interface SseEvent {
  type?: string
  [k: string]: unknown
}

/**
 * Мінімальний SSE-парсер для /tts/sse: читає ReadableStream,
 * розбиває на події по подвійному переносу рядка, парсить data:-рядки як JSON.
 */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let sep: number
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        const dataLines = rawEvent
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
        if (!dataLines.length) continue
        const payload = dataLines.join('')
        if (payload === '[DONE]') {
          yield { type: 'done' }
          continue
        }
        try {
          yield JSON.parse(payload) as SseEvent
        } catch {
          // не-JSON рядок — ігноруємо
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
