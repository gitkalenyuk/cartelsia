/**
 * Витягує повні Cartesia-ключі (sk_car_…) з довільного тексту сторінки.
 * Вимагає достатньої довжини «тіла», щоб не хапати замасковані ключі (sk_car_••••)
 * чи скорочені `sk_car_…abcd` з дашборду.
 */
const KEY_RE = /sk_car_[A-Za-z0-9_-]{16,}/g

export function extractCartesiaKeys(text: string): string[] {
  if (!text) return []
  const found = text.match(KEY_RE) ?? []
  // прибираємо явні маски/заглушки й дублі
  const clean = found.filter((k) => !/[•*·…]/.test(k) && !/x{6,}/i.test(k))
  return [...new Set(clean)]
}
