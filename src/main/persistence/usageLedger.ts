import { appendFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { UsageEvent, UsageStatDay } from '../../shared/types'

/** Append-only журнал витрат символів (data/usage.jsonl) */
export class UsageLedger {
  private file: string

  constructor(dataDir: string) {
    this.file = join(dataDir, 'usage.jsonl')
  }

  append(event: UsageEvent): void {
    try {
      appendFileSync(this.file, JSON.stringify(event) + '\n', 'utf8')
    } catch (err) {
      console.error('[usageLedger] append failed:', err)
    }
  }

  readAll(): UsageEvent[] {
    if (!existsSync(this.file)) return []
    const out: UsageEvent[] = []
    for (const line of readFileSync(this.file, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        out.push(JSON.parse(trimmed) as UsageEvent)
      } catch {
        // пошкоджений рядок — пропускаємо
      }
    }
    return out
  }

  /** Агрегація по днях за останні N днів */
  dailyStats(days = 30, now: Date = new Date()): UsageStatDay[] {
    const events = this.readAll()
    const byDay = new Map<string, UsageStatDay>()

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86_400_000)
      const day = d.toISOString().slice(0, 10)
      byDay.set(day, { day, perKey: {}, total: 0 })
    }

    for (const e of events) {
      const day = e.ts.slice(0, 10)
      const stat = byDay.get(day)
      if (!stat) continue
      stat.perKey[e.keyId] = (stat.perKey[e.keyId] ?? 0) + e.chars
      stat.total += e.chars
    }
    return [...byDay.values()]
  }
}
