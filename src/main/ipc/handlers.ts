import { BrowserWindow, dialog, ipcMain, shell, app } from 'electron'
import { readFileSync, writeFileSync, appendFileSync } from 'fs'
import { join, basename } from 'path'
import {
  DEFAULT_SETTINGS,
  type Chat,
  type GenerationSettings,
  type MainEvent,
  type Settings
} from '../../shared/types'
import { IPC } from '../../shared/ipcContract'
import { dataDir, outputDir, isPortable } from '../paths'
import { loadJson, saveJson } from '../persistence/jsonStore'
import type { ChatStore } from '../persistence/chatStore'
import type { UsageLedger } from '../persistence/usageLedger'
import type { KeyPool } from '../keys/keyPool'
import type { Scheduler } from '../tts/scheduler'
import type { VoicesService } from '../voices/voicesService'
import type { CartesiaClient } from '../cartesia/client'
import { chunkText } from '../tts/chunker'
import { estimate } from '../tts/estimator'
import { buildSubtitles, SubtitleError } from '../subtitles/srt'
import { showCompletionNotification } from '../notify'
import { ImapClient } from '../email/imapClient'
import { PlaywrightRegistrar } from '../email/playwrightRegistrar'
import { ClerkApiRegistrar } from '../email/clerkApiRegistrar'
import { AutoregService } from '../email/autoregService'
import { BrowserSignupRegistrar } from '../email/browserSignupRegistrar'
import { ProxyManager } from '../proxy/proxyManager'

export interface Services {
  pool: KeyPool
  scheduler: Scheduler
  chats: ChatStore
  voices: VoicesService
  ledger: UsageLedger
  client: CartesiaClient
  registrar: PlaywrightRegistrar
  clerkApiRegistrar: ClerkApiRegistrar
  autoregService: AutoregService
  proxyManager: ProxyManager
}

let settings: Settings

function settingsFile(): string {
  return join(dataDir(), 'settings.json')
}

export function loadSettings(): Settings {
  settings = loadJson<Settings>(settingsFile(), DEFAULT_SETTINGS)
  // мердж із дефолтами, якщо файл зі старої версії
  settings = {
    ...DEFAULT_SETTINGS,
    ...settings,
    defaults: { ...DEFAULT_SETTINGS.defaults, ...settings.defaults }
  }
  // 2.0 нормалізація: мертві рушії (clerk-api, browserless) → новий browser-signup
  if (settings.autoreg?.engine === 'clerk-api' || settings.autoreg?.engine === 'browserless') {
    settings.autoreg = { ...settings.autoreg, engine: 'browser-signup' }
  }
  return settings
}

export function registerIpcHandlers(services: Services, getWindow: () => BrowserWindow | null): void {
  const { pool, scheduler, chats, voices, ledger, client, registrar, clerkApiRegistrar, autoregService, proxyManager } = services
  loadSettings()
  // Рушій реєстрації за settings.autoreg.engine (default 'browser-signup' у 2.0)
  // OTP — прямий IMAP (REGER-механізм): свіже з'єднання + HEADER To пошук на кожен запит.
  const imapForOtp = () => ({
    host: settings.imapConfig?.host ?? 'imap.gmail.com',
    port: settings.imapConfig?.port ?? 993,
    user: settings.imapConfig?.user ?? '',
    pass: settings.imapConfig?.pass ?? ''
  })
  const browserSignup = new BrowserSignupRegistrar({
    proxyGetter: () => (settings.autoreg?.useProxy ? proxyManager.rotate() : null),
    headless: settings.autoreg?.headless ?? true,
    imap: imapForOtp()
  })
  browserSignup.onLog = (line) => broadcast({ type: 'autoreg-log', line })
  const activeRegistrar = () => {
    // 2.0: clerk-api і browserless МЕРТВІ (Clerk soft-block створення юзерів).
    // Старі settings можуть містити 'clerk-api' — ігноруємо, тільки два живі варіанти:
    // 'playwright' (legacy visible-window) або 'browser-signup' (новий, default).
    const eng = settings.autoreg?.engine
    if (eng === 'playwright') return registrar
    return browserSignup
  }
  scheduler.setGlobalCap(settings.globalConcurrencyCap)

  const broadcast = (event: MainEvent): void => {
    getWindow()?.webContents.send(IPC.EVENT, event)
  }

  pool.on('key-updated', (key) => broadcast({ type: 'key-updated', key }))

  // Легасі: прямі captcha з registrar (для старих викликів registerOne напряму)
  registrar.on('captcha', (payload: { email: string; message: string }) => {
    // Якщо AutoregService активний — він сам прокине captcha через свій слухач
    if (!autoregService.isRunning()) {
      broadcast({ type: 'autoreg-captcha', email: payload.email, message: payload.message })
    }
  })

  // Потокові події AutoregService
  autoregService.on('progress', (payload: { items: unknown[]; current: number; total: number }) => {
    broadcast({ type: 'autoreg-progress', items: payload.items as never, current: payload.current, total: payload.total })
  })
  autoregService.on('captcha', (payload: { email: string; message: string }) => {
    broadcast({ type: 'autoreg-captcha', email: payload.email, message: payload.message })
  })
  autoregService.on('item-done', (payload: { item: unknown; index: number }) => {
    broadcast({ type: 'autoreg-item-done', item: payload.item as never, index: payload.index })
  })
  autoregService.on('done', (payload: { items: unknown[] }) => {
    broadcast({ type: 'autoreg-done', items: payload.items as never })
  })
  scheduler.on('event', (event: MainEvent) => {
    broadcast(event)
    if (event.type === 'queue-finished' && settings.notifySystem) {
      const chat = chats.get(event.chatId)
      showCompletionNotification({
        title: chat?.title ?? '',
        chunks: event.ok + event.failed,
        chars: event.chars,
        failed: event.failed
      })
    }
  })

  // ---------- Ключі ----------
  ipcMain.handle(IPC.KEYS_LIST, () => pool.listPublic())

  ipcMain.handle(
    IPC.KEYS_ADD,
    (_e, payload: { keys: string[]; label?: string; role?: 'pool' | 'clone' }) =>
      pool.addKeys(payload.keys, payload.label, payload.role ?? 'pool')
  )

  ipcMain.handle(IPC.KEYS_IMPORT_TXT, async () => {
    const win = getWindow()
    if (!win) return { added: [], rejected: [] }
    const res = await dialog.showOpenDialog(win, {
      title: 'Імпорт ключів із .txt',
      filters: [{ name: 'Текстові файли', extensions: ['txt'] }],
      properties: ['openFile']
    })
    if (res.canceled || !res.filePaths[0]) return { added: [], rejected: [] }
    const lines = readFileSync(res.filePaths[0], 'utf8').split(/\r?\n/)
    return pool.addKeys(lines)
  })

  ipcMain.handle(IPC.KEYS_UPDATE, (_e, p: { id: string; patch: { label?: string; limit?: number } }) =>
    pool.update(p.id, p.patch)
  )

  ipcMain.handle(IPC.KEYS_REMOVE, (_e, p: { id: string }) => pool.remove(p.id))

  ipcMain.handle(IPC.KEYS_PROBE, (_e, p: { id: string; quotaProbe?: boolean }) => {
    const probeRunner = p.quotaProbe
      ? {
          run: async (rawKey: string): Promise<void> => {
            // мінімальна генерація «.» — ~1 кредит; голос беремо будь-який публічний
            const page = await client.listVoices(rawKey, { limit: 1 })
            const voiceId = page.data[0]?.id
            if (!voiceId) throw new Error('Немає голосу для проби')
            await client.ttsBytes(rawKey, '.', {
              ...settings.defaults,
              voiceId,
              output: { container: 'mp3', sampleRate: 44100, bitRate: 128000 },
              subtitleMode: false
            })
          }
        }
      : null
    return pool.probe(p.id, probeRunner)
  })

  // ---------- Чати ----------
  ipcMain.handle(IPC.CHATS_LIST, () => chats.list())
  ipcMain.handle(IPC.CHATS_GET, (_e, p: { id: string }) => chats.get(p.id))

  ipcMain.handle(
    IPC.CHATS_CREATE,
    (_e, p: { text: string; settings: GenerationSettings }) => {
      const texts = chunkText(p.text, p.settings.chunkSize)
      const chat: Chat = {
        id: crypto.randomUUID(),
        title: p.text.trim().slice(0, 48).replace(/\s+/g, ' ') || 'Нова генерація',
        createdAt: new Date().toISOString(),
        sourceText: p.text,
        settings: p.settings,
        status: 'draft',
        chunks: texts.map((text, index) => ({
          id: crypto.randomUUID(),
          index,
          text,
          status: 'pending',
          attempts: 0,
          versions: []
        }))
      }
      chats.create(chat)
      const est = estimate(texts, pool, p.settings.voiceOwningKeyId)
      return { chat, estimate: est }
    }
  )

  ipcMain.handle(IPC.CHATS_DELETE, (_e, p: { id: string }) => chats.delete(p.id))

  ipcMain.handle(IPC.CHATS_RENAME, (_e, p: { id: string; title: string }) => {
    const chat = chats.get(p.id)
    if (!chat) return
    chat.title = p.title.trim() || chat.title
    chats.save(chat, true)
    broadcast({ type: 'chat-updated', chat })
  })

  ipcMain.handle(IPC.CHATS_UPDATE_CHUNK_TEXT, (_e, p: { chatId: string; chunkId: string; text: string }) => {
    const chat = chats.get(p.chatId)
    if (!chat) return null
    const chunk = chat.chunks.find((c) => c.id === p.chunkId)
    if (!chunk) return null
    chunk.text = p.text
    if (chunk.versions.length) chunk.textEditedAfterVoice = true
    chats.save(chat, true)
    return chunk
  })

  ipcMain.handle(IPC.CHATS_SELECT_VERSION, (_e, p: { chatId: string; chunkId: string; versionId: string }) => {
    const chat = chats.get(p.chatId)
    if (!chat) return
    const chunk = chat.chunks.find((c) => c.id === p.chunkId)
    if (!chunk) return
    if (chunk.versions.some((v) => v.id === p.versionId)) {
      chunk.selectedVersionId = p.versionId
      chats.save(chat, true)
    }
  })

  // ---------- Генерація ----------
  ipcMain.handle(IPC.TTS_ESTIMATE, (_e, p: { text: string; settings: GenerationSettings }) => {
    const texts = chunkText(p.text, p.settings.chunkSize)
    return estimate(texts, pool, p.settings.voiceOwningKeyId)
  })

  ipcMain.handle(IPC.TTS_START, (_e, p: { chatId: string }) => {
    const chat = chats.get(p.chatId)
    if (!chat) throw new Error('Чат не знайдено')
    scheduler.start(chat)
  })

  ipcMain.handle(IPC.TTS_PAUSE, (_e, p: { chatId: string }) => scheduler.pause(p.chatId))
  ipcMain.handle(IPC.TTS_RESUME, (_e, p: { chatId: string }) => scheduler.resume(p.chatId))
  ipcMain.handle(IPC.TTS_CANCEL, (_e, p: { chatId: string }) => scheduler.cancel(p.chatId))
  ipcMain.handle(IPC.TTS_RETRY_CHUNK, (_e, p: { chatId: string; chunkId: string }) =>
    scheduler.retryChunk(p.chatId, p.chunkId)
  )
  ipcMain.handle(
    IPC.TTS_REVOICE_CHUNK,
    (_e, p: { chatId: string; chunkId: string; overrides?: Partial<GenerationSettings> }) =>
      scheduler.revoiceChunk(p.chatId, p.chunkId, p.overrides)
  )

  // у E2E-режимі нативні діалоги неможливо автоматизувати — пишемо одразу в output/
  const skipDialogs = process.env.CARTELSIA_E2E === '1'

  // ---------- Аудіо ----------
  ipcMain.handle(
    IPC.AUDIO_SAVE_MERGED,
    async (_e, p: { chatId: string; data: ArrayBuffer; format: 'mp3' | 'wav'; suggestedName: string }) => {
      const win = getWindow()
      const defaultPath = join(outputDir(), p.suggestedName)
      let target = defaultPath
      if (win && !skipDialogs) {
        const res = await dialog.showSaveDialog(win, {
          title: 'Зберегти обʼєднаний файл',
          defaultPath,
          filters: [{ name: p.format.toUpperCase(), extensions: [p.format] }]
        })
        if (res.canceled || !res.filePath) return { path: null }
        target = res.filePath
      }
      writeFileSync(target, Buffer.from(p.data))
      const chat = chats.get(p.chatId)
      if (chat) {
        chat.mergedFilePath = target
        chats.save(chat, true)
      }
      return { path: target }
    }
  )

  ipcMain.handle(IPC.AUDIO_SAVE_CHUNK, async (_e, p: { chatId: string; file: string }) => {
    const win = getWindow()
    const src = chats.audioPath(p.chatId, p.file)
    const defaultPath = join(outputDir(), basename(src))
    if (skipDialogs) {
      writeFileSync(defaultPath, readFileSync(src))
      return { path: defaultPath }
    }
    if (!win) return { path: null }
    const res = await dialog.showSaveDialog(win, {
      title: 'Зберегти фрагмент',
      defaultPath
    })
    if (res.canceled || !res.filePath) return { path: null }
    writeFileSync(res.filePath, readFileSync(src))
    return { path: res.filePath }
  })

  // байти чанка для склейки в renderer (fetch до кастомного протоколу CORS-примхливий)
  ipcMain.handle(IPC.AUDIO_READ_CHUNK, (_e, p: { chatId: string; file: string }) => {
    const buf = readFileSync(chats.audioPath(p.chatId, p.file))
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  })

  ipcMain.handle(IPC.AUDIO_REVEAL, (_e, p: { path: string }) => shell.showItemInFolder(p.path))

  // ---------- Голоси ----------
  ipcMain.handle(IPC.VOICES_LIST, (_e, p) => voices.list(p ?? {}))
  ipcMain.handle(IPC.VOICES_CLONE, (_e, p) => voices.clone(p))
  ipcMain.handle(IPC.VOICES_LOCALIZE, (_e, p) => voices.localize(p))
  ipcMain.handle(IPC.VOICES_DELETE_CLONE, (_e, p: { voiceId: string }) => voices.deleteClone(p.voiceId))
  ipcMain.handle(IPC.VOICES_FAVORITES_LIST, () => voices.listFavorites())
  ipcMain.handle(IPC.VOICES_FAVORITES_TOGGLE, (_e, p) => voices.toggleFavorite(p))
  ipcMain.handle(IPC.VOICES_CLONES_LIST, () => voices.listClones())
  ipcMain.handle(
    IPC.VOICES_GET_PREVIEW,
    (_e, p: { voiceId: string; previewUrl?: string; language?: string }) => voices.getPreview(p)
  )
  ipcMain.handle(IPC.VOICES_SCAN_CLONES, () => voices.scanClones())

  // ---------- Налаштування / шляхи / статистика ----------
  ipcMain.handle(IPC.SETTINGS_GET, () => settings)

  ipcMain.handle(IPC.EMAIL_TEST_IMAP, (_e, p: { config?: typeof settings.imapConfig }) => {
    const cfg = p.config ?? settings.imapConfig
    if (!cfg || !cfg.host || !cfg.user || !cfg.pass) {
      return { ok: false, error: 'IMAP налаштування не заповнені' }
    }
    return ImapClient.testConnection(cfg)
  })

  ipcMain.handle(IPC.EMAIL_CHECK_VERIFICATION, (_e, p: { email: string; sinceMs?: number }) => {
    const cfg = settings.imapConfig
    if (!cfg || !cfg.host || !cfg.user || !cfg.pass) {
      return { found: false, error: 'IMAP не налаштовано в Налаштуваннях' }
    }
    return ImapClient.findVerificationLink(cfg, p.email, p.sinceMs)
  })

  ipcMain.handle(IPC.EMAIL_SAVE_ACCOUNT_FILE, (_e, p: { email: string; pass: string; key?: string }) => {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
    const line = `${now} | Email: ${p.email} | Pass: ${p.pass} | Key: ${p.key || 'no-key'}\n`
    const path1 = join(dataDir(), 'accounts.txt')
    const path2 = join(outputDir(), 'accounts.txt')
    try { appendFileSync(path1, line, 'utf8') } catch (_) {}
    try { appendFileSync(path2, line, 'utf8') } catch (_) {}
    return { path: path1 }
  })

  ipcMain.handle(
    IPC.AUTOREG_RUN,
    async (
      _e,
      p: {
        count: number
        catchAllDomain: string
        imapConfig: typeof settings.imapConfig
        captchaProvider?: 'manual' | '2captcha' | 'capsolver'
        captchaApiKey?: string
        delayMs?: number
        concurrency?: number
        headless?: boolean
        useProxy?: boolean
      }
    ) => {
      const cfg = p.imapConfig ?? settings.imapConfig
      if (!cfg || !cfg.host || !cfg.user || !cfg.pass) {
        return { ok: false, error: 'IMAP не налаштовано' }
      }
      if (autoregService.isRunning()) {
        return { ok: false, error: 'Автореєстрація вже запущена' }
      }
      const win = getWindow()
      // Неблокуючий: запускаємо у фоні, одразу повертаємо ok
      browserSignup.headless = p.headless ?? settings.autoreg?.headless ?? true
      browserSignup.proxyGetter = () => (p.useProxy ?? settings.autoreg?.useProxy ?? false ? proxyManager.rotate() : null)
      browserSignup.imap = imapForOtp()  // свіжі IMAP-креденшали на кожен прогін
      autoregService.setRegistrar(activeRegistrar())
      const opts = {
        count: p.count,
        catchAllDomain: p.catchAllDomain,
        imapConfig: cfg,
        captchaProvider: (p.captchaProvider ?? settings.autoreg?.captchaProvider ?? 'manual') as never,
        captchaApiKey: p.captchaApiKey ?? settings.autoreg?.captchaApiKey,
        delayMs: p.delayMs ?? settings.autoreg?.delayMs,
        concurrency: p.concurrency ?? settings.autoreg?.concurrency ?? 1
      }
      // Запускаємо без await — прогрес іде через MainEvent
      autoregService.run(opts, win).catch((err) => {
        console.error('[autoreg] service run failed:', err)
        broadcast({ type: 'autoreg-done', items: autoregService.getItems() as never })
      })
      return { ok: true, started: true }
    }
  )

  // Легасі синхронний шлях (для тестів / скриптів): чекає завершення
  ipcMain.handle('autoreg:runSync' as never, async (
    _e: unknown,
    p: { count: number; catchAllDomain: string; imapConfig: typeof settings.imapConfig }
  ) => {
    const cfg = (p as { imapConfig: typeof settings.imapConfig }).imapConfig ?? settings.imapConfig
    if (!cfg || !cfg.host || !cfg.user || !cfg.pass) return { ok: false, error: 'IMAP не налаштовано' }
    const win = getWindow()
    autoregService.setRegistrar(activeRegistrar())
    const items = await autoregService.run({ count: p.count, catchAllDomain: p.catchAllDomain, imapConfig: cfg, concurrency: settings.autoreg?.concurrency ?? 1 }, win)
    const results = items.map((it) => ({ email: it.email, pass: it.pass, success: it.state === 'done' && !!it.key, key: it.key, error: it.error }))
    return { ok: true, results }
  })

  ipcMain.handle(IPC.AUTOREG_CONTINUE, () => {
    if (autoregService.isRunning()) autoregService.resumeCaptcha()
    else activeRegistrar().resume()
    return { ok: true }
  })

  ipcMain.handle(IPC.AUTOREG_CANCEL, () => {
    activeRegistrar().cancelCaptcha()
    return { ok: true }
  })

  ipcMain.handle(IPC.AUTOREG_STOP, () => {
    autoregService.cancel()
    return { ok: true }
  })

  ipcMain.handle(IPC.AUTOREG_STATUS, () => {
    return { running: autoregService.isRunning(), items: autoregService.getItems() }
  })

  ipcMain.handle(IPC.SETTINGS_SET, (_e, p: { patch: Partial<Settings> }) => {
    settings = {
      ...settings,
      ...p.patch,
      defaults: { ...settings.defaults, ...(p.patch.defaults ?? {}) }
    }
    scheduler.setGlobalCap(settings.globalConcurrencyCap)
    saveJson(settingsFile(), settings)
    return settings
  })

  ipcMain.handle(IPC.PATHS_GET, () => ({
    dataDir: dataDir(),
    outputDir: outputDir(),
    portable: isPortable()
  }))

  ipcMain.handle(IPC.STATS_GET, () => {
    const days = ledger.dailyStats(30)
    const events = ledger.readAll()
    const totalChars = events.reduce((s, e) => s + e.chars, 0)
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    const monthChars = events
      .filter((e) => new Date(e.ts) >= monthStart)
      .reduce((s, e) => s + e.chars, 0)
    const activeDays = days.filter((d) => d.total > 0).length || 1
    const keyLabels: Record<string, string> = {}
    for (const k of pool.listPublic()) keyLabels[k.id] = k.label
    return {
      totalChars,
      monthChars,
      activeKeys: pool.activeCount(),
      avgPerDay: Math.round(days.reduce((s, d) => s + d.total, 0) / activeDays),
      days,
      keyLabels
    }
  })

  // ---------- Субтитри ----------
  ipcMain.handle(IPC.SUBTITLES_EXPORT, async (_e, p: { chatId: string; format: 'srt' | 'vtt' }) => {
    const chat = chats.get(p.chatId)
    if (!chat) throw new Error('Чат не знайдено')
    let content: string
    try {
      content = buildSubtitles(chat, p.format)
    } catch (err) {
      if (err instanceof SubtitleError) {
        return { path: null, error: `Фрагменти без таймкодів: ${err.missingChunks.join(', ')}. Увімкніть субтитр-режим і переозвучте їх.` }
      }
      throw err
    }
    const win = getWindow()
    const safeTitle = chat.title.replace(/[<>:"/\\|?*]/g, '').slice(0, 30) || 'subtitles'
    const defaultPath = join(outputDir(), `${safeTitle}.${p.format}`)
    if (skipDialogs) {
      writeFileSync(defaultPath, content, 'utf8')
      return { path: defaultPath }
    }
    if (!win) return { path: null }
    const res = await dialog.showSaveDialog(win, {
      title: 'Експорт субтитрів',
      defaultPath,
      filters: [{ name: p.format.toUpperCase(), extensions: [p.format] }]
    })
    if (res.canceled || !res.filePath) return { path: null }
    writeFileSync(res.filePath, content, 'utf8')
    return { path: res.filePath }
  })

  // ---------- Проксі ----------
  ipcMain.handle(IPC.PROXY_GRAB, async (_e, p: { url: string }) => {
    const list = await proxyManager.fetchFromUrl(p.url)
    proxyManager.addProxies(list)
    return { grabbed: list.length, proxies: proxyManager.list() }
  })

  ipcMain.handle(IPC.PROXY_IMPORT, (_e, p: { text: string }) => {
    const added = proxyManager.addFromText(p.text)
    return { added, proxies: proxyManager.list() }
  })

  ipcMain.handle(IPC.PROXY_CHECK, async () => {
    await proxyManager.checkAll()
    return { proxies: proxyManager.list() }
  })

  ipcMain.handle(IPC.PROXY_LIST, () => proxyManager.list())

  ipcMain.handle(IPC.PROXY_REMOVE, (_e, p: { url: string }) => {
    proxyManager.remove(p.url)
    return { proxies: proxyManager.list() }
  })

  // ---------- Debug (тільки dev / e2e) ----------
  if (!app.isPackaged || process.env.CARTELSIA_E2E === '1') {
    ipcMain.handle(IPC.DEBUG_SET_KEY_USAGE, (_e, p: { keyId: string; usedChars: number }) =>
      pool.update(p.keyId, { usedChars: p.usedChars })
    )
  }
}
