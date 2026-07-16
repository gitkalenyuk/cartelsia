import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'

let cachedDataDir: string | null = null
let cachedOutputDir: string | null = null
let cachedPortable = false

function isWritable(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true })
    const probe = join(dir, '.write-probe')
    writeFileSync(probe, 'ok')
    rmSync(probe)
    return true
  } catch {
    return false
  }
}

function resolveRoots(): void {
  if (cachedDataDir) return

  const override = process.env.CARTELSIA_DATA_DIR
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR

  if (override) {
    cachedDataDir = join(override, 'data')
    cachedOutputDir = join(override, 'output')
    cachedPortable = false
  } else if (portableDir && isWritable(join(portableDir, 'data'))) {
    // portable exe: дані подорожують разом із файлом
    cachedDataDir = join(portableDir, 'data')
    cachedOutputDir = join(portableDir, 'output')
    cachedPortable = true
  } else {
    cachedDataDir = join(app.getPath('userData'), 'data')
    cachedOutputDir = join(app.getPath('userData'), 'output')
    cachedPortable = false
  }
  mkdirSync(cachedDataDir, { recursive: true })
  mkdirSync(cachedOutputDir, { recursive: true })
  mkdirSync(join(cachedDataDir, 'chats'), { recursive: true })
}

export function dataDir(): string {
  resolveRoots()
  return cachedDataDir!
}

export function outputDir(): string {
  resolveRoots()
  return cachedOutputDir!
}

export function isPortable(): boolean {
  resolveRoots()
  return cachedPortable
}

export function chatDir(chatId: string): string {
  const dir = join(dataDir(), 'chats', chatId)
  if (!existsSync(dir)) mkdirSync(join(dir, 'audio'), { recursive: true })
  return dir
}
