import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'

/** Атомарний запис JSON: tmp-файл + rename, щоб не втратити дані при краші */
export function saveJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = join(dirname(path), `.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`)
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tmp, path)
}

export function loadJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch (err) {
    console.error(`[jsonStore] failed to read ${path}:`, err)
    return fallback
  }
}

const pending = new Map<string, { timer: NodeJS.Timeout; resolve: () => unknown }>()

/** Дебаунс-запис: часті оновлення (статуси чанків) не молотять диск */
export function saveJsonDebounced(path: string, resolve: () => unknown, delayMs = 400): void {
  const existing = pending.get(path)
  if (existing) clearTimeout(existing.timer)
  pending.set(path, {
    resolve,
    timer: setTimeout(() => {
      pending.delete(path)
      try {
        saveJson(path, resolve())
      } catch (err) {
        console.error(`[jsonStore] debounced save failed ${path}:`, err)
      }
    }, delayMs)
  })
}

/** Форсувати всі відкладені записи (викликається перед виходом із додатку) */
export function flushAll(): void {
  for (const [path, entry] of pending) {
    clearTimeout(entry.timer)
    pending.delete(path)
    try {
      saveJson(path, entry.resolve())
    } catch (err) {
      console.error(`[jsonStore] flush failed ${path}:`, err)
    }
  }
}
