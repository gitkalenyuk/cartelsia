/**
 * Файловий лог main-процесу (dataDir/main.log) + mirror у console.
 * Чому: у production-збірці console не має термінала — крах main = тиша.
 * Інцидент 25.08.2026 ~16:00: батч з 28 акаунтів замер у 'form', процес
 * зник, і причини не було де шукати (main.log тоді ще не існував).
 * Ротація: >2MB -> main.log.1 (старий .1 -> .old).
 */
import { appendFileSync, existsSync, renameSync, statSync } from 'fs'
import { join } from 'path'

const MAX_BYTES = 2 * 1024 * 1024
let logPath: string | null = null

type ConsoleFn = (...args: unknown[]) => void

function safeText(v: unknown): string {
  if (v instanceof Error) return v.stack || v.message
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function writeLine(level: string, args: unknown[]): void {
  const path = logPath
  if (!path) return
  try {
    if (existsSync(path) && statSync(path).size > MAX_BYTES) {
      const one = path + '.1'
      try {
        if (existsSync(one)) renameSync(one, one + '.old')
      } catch {
        /* ігнор */
      }
      renameSync(path, one)
    }
    const stamp = new Date().toISOString()
    appendFileSync(path, '[' + stamp + '] [' + level + '] ' + args.map(safeText).join(' ') + '\n', 'utf8')
  } catch {
    /* лог не має ламати основний flow */
  }
}

export function setupMainLogging(dir: string): void {
  logPath = join(dir, 'main.log')
  const origLog = console.log as ConsoleFn
  const origWarn = console.warn as ConsoleFn
  const origError = console.error as ConsoleFn
  const wrap = (origFn: ConsoleFn, level: string): ConsoleFn => {
    return (...args: unknown[]): void => {
      origFn(...args)
      writeLine(level, args)
    }
  }
  const c = console as unknown as { log: ConsoleFn; warn: ConsoleFn; error: ConsoleFn }
  c.log = wrap(origLog, 'log')
  c.warn = wrap(origWarn, 'warn')
  c.error = wrap(origError, 'error')
  console.log('[main] файловий лог -> ' + logPath)
}
