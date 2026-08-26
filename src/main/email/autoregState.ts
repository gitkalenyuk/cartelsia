/**
 * Резюм автореєстрації (P0): якщо процес/JS впаде на 30-му з 50 акаунтів,
 * наступний запуск зможе продовжити з того ж місця.
 *
 * State зберігається в `<dataDir>/autoreg-state.json` через атомарний rename
 * (write to .tmp → fsync → rename). Файл читається лише при старті й коли
 * опція `resume=true` передана в `run()`.
 *
 * Формат файлу:
 *   {
 *     "version": 1,
 *     "startedAt": "2026-01-15T12:00:00.000Z",
 *     "updatedAt": "...",
 *     "catchAllDomain": "kaleny.uk",
 *     "items": [ { "email": "...", "pass": "...", "phase": "done", "key": "sk_car_...",
 *                  "attempts": 1, "error": null }, ... ]
 *   }
 */

import { renameSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs'
import { join } from 'path'

export const AUTOREG_STATE_VERSION = 1 as const

export type AutoregResumePhase =
  | 'queued'
  | 'form'
  | 'waiting-mail'
  | 'verifying'
  | 'creating-key'
  | 'done'
  | 'failed'

export interface AutoregResumeItem {
  email: string
  pass: string
  phase: AutoregResumePhase
  key?: string
  attempts: number
  error?: string | null
}

export interface AutoregResumeState {
  version: number
  startedAt: string
  updatedAt: string
  catchAllDomain: string
  items: AutoregResumeItem[]
}

/** Дефолтний стан (порожній). */
export function emptyState(catchAllDomain = ''): AutoregResumeState {
  const now = new Date().toISOString()
  return {
    version: AUTOREG_STATE_VERSION,
    startedAt: now,
    updatedAt: now,
    catchAllDomain,
    items: [],
  }
}

/** Шлях до файлу стану. */
export function statePath(dataDir: string): string {
  return join(dataDir, 'autoreg-state.json')
}

/** Створює директорію якщо треба, тихо. */
function ensureDir(p: string): void {
  try {
    if (!existsSync(p)) mkdirSync(p, { recursive: true })
  } catch {
    /* ignore */
  }
}

/** Атомарний запис JSON: write → fsync → rename (стійкий до краху процесу). */
export function writeState(dataDir: string, state: AutoregResumeState): void {
  ensureDir(dataDir)
  const filePath = statePath(dataDir)
  const tmpPath = `${filePath}.tmp`
  const json = JSON.stringify(state, null, 2)
  try {
    // Write to temp
    writeFileSync(tmpPath, json, 'utf8')
    // Atomic rename — гарантує що читач побачить або стару, або нову версію,
    // але ніколи частковий файл (навіть при power-cut).
    renameSync(tmpPath, filePath)
  } catch {
    /* swallow — resume best-effort, не ламаємо основний flow */
  }
}

/** Зчитує стан із диску. Повертає null якщо файлу немає / corrupt / невідома версія. */
export function readState(dataDir: string): AutoregResumeState | null {
  const filePath = statePath(dataDir)
  if (!existsSync(filePath)) return null
  try {
    const raw = readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw) as AutoregResumeState
    if (parsed.version !== AUTOREG_STATE_VERSION) return null
    if (!Array.isArray(parsed.items)) return null
    return parsed
  } catch {
    return null
  }
}

/** Видаляє файл стану (викликати коли всі акаунти опрацьовані або пачка скасована). */
export function clearState(dataDir: string): void {
  const filePath = statePath(dataDir)
  const tmpPath = `${filePath}.tmp`
  try {
    if (existsSync(filePath)) renameSync(filePath, `${filePath}.bak-${Date.now()}`)
    if (existsSync(tmpPath)) renameSync(tmpPath, `${tmpPath}.bak-${Date.now()}`)
  } catch {
    /* ignore */
  }
}

/**
 * Повертає тільки ті items, які треба реально опрацювати (не done, не failed).
 * Використовується при resume=true: пропускаємо вже успішно створені акаунти.
 */
export function resumableItems(state: AutoregResumeState): AutoregResumeItem[] {
  return state.items.filter((it) => it.phase !== 'done')
}

/** Лічильник резюму: "X/Y вже готові, продовжимо з Z". */
export function summarize(state: AutoregResumeState): {
  total: number
  done: number
  remaining: number
  failed: number
} {
  const total = state.items.length
  let done = 0
  let failed = 0
  for (const it of state.items) {
    if (it.phase === 'done') done++
    else if (it.phase === 'failed') failed++
  }
  return { total, done, remaining: total - done - failed, failed }
}
