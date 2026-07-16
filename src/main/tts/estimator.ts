import type { KeyAllocation, PreflightEstimate } from '../../shared/types'
import type { KeyPool } from '../keys/keyPool'

/**
 * Преф-лайт: жадібна симуляція best-fit-decreasing.
 * Сума remaining ≥ totalChars — необхідна, але НЕ достатня умова
 * (один чанк може лягти лише на один ключ), тому симулюємо розкладку.
 */
export function estimate(
  chunkTexts: string[],
  pool: KeyPool,
  pinnedKeyId?: string
): PreflightEstimate {
  const totalChars = chunkTexts.reduce((sum, c) => sum + c.length, 0)

  const keys = pool
    .listPublic()
    .filter((k) => k.status === 'active')
    .filter((k) => !pinnedKeyId || k.id === pinnedKeyId)
    .map((k) => ({ id: k.id, label: k.label, remaining: k.remaining, used: 0, chunks: 0 }))

  const poolRemaining = keys.reduce((s, k) => s + k.remaining, 0)

  // розкладаємо ВЕЛИКІ чанки першими (best-fit-decreasing) — стабільніша упаковка
  const order = chunkTexts
    .map((text, index) => ({ index, cost: text.length }))
    .sort((a, b) => b.cost - a.cost)

  const blockedChunks: { index: number; reason: string }[] = []
  let fittable = 0

  for (const { index, cost } of order) {
    // best-fit: найменший залишок, що вміщує
    let best: (typeof keys)[number] | null = null
    for (const k of keys) {
      const left = k.remaining - k.used
      if (left >= cost && (!best || left < best.remaining - best.used)) best = k
    }
    if (best) {
      best.used += cost
      best.chunks += 1
      fittable += 1
    } else {
      blockedChunks.push({
        index,
        reason: pinnedKeyId
          ? 'Ключ-власник клон-голосу не вміщує цей фрагмент'
          : 'Жоден ключ не вміщує цей фрагмент'
      })
    }
  }

  const allocations: KeyAllocation[] = keys
    .filter((k) => k.chunks > 0)
    .map((k) => ({
      keyId: k.id,
      keyLabel: k.label,
      chunkCount: k.chunks,
      chars: k.used,
      remainingAfter: k.remaining - k.used
    }))

  return {
    totalChars,
    chunkCount: chunkTexts.length,
    poolRemaining,
    feasible: blockedChunks.length === 0,
    fittableChunks: fittable,
    allocations,
    blockedChunks: blockedChunks.sort((a, b) => a.index - b.index)
  }
}
