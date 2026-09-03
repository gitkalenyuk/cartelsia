import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { dataDir } from './paths'
import { registerMediaScheme, handleMediaProtocol } from './protocol'
import { flushAll } from './persistence/jsonStore'
import { CartesiaClient } from './cartesia/client'
import { KeyPool } from './keys/keyPool'
import { UsageLedger } from './persistence/usageLedger'
import { ChatStore } from './persistence/chatStore'
import { Scheduler } from './tts/scheduler'
import { VoicesService } from './voices/voicesService'
import { MasterVoiceService } from './voices/masterVoiceService'
import { SharedVoiceRegistry } from './voices/sharedVoiceRegistry'
import { TtsCache } from './tts/ttsCache'
import { registerIpcHandlers } from './ipc/handlers'
import { PlaywrightRegistrar } from './email/playwrightRegistrar'
import { ClerkApiRegistrar } from './email/clerkApiRegistrar'
import { AutoregService } from './email/autoregService'
import { ProxyManager } from './proxy/proxyManager'
import { setupMainLogging } from './logging'
import { DEFAULT_SETTINGS } from '../shared/types'

registerMediaScheme()

let mainWindow: BrowserWindow | null = null
let autoregRef: AutoregService | null = null

let getSettingsSnapshotImpl: () => import('../shared/types').Settings = () => ({
  ...DEFAULT_SETTINGS,
  notifySystem: true,
  notifySound: true
})

/** Живий знімок налаштувань (оновлюється handlers.loadSettings / SETTINGS_SET) */
function getSettingsSnapshot(): import('../shared/types').Settings {
  return getSettingsSnapshotImpl()
}

/** handlers викликають це, щоб index мав актуальні settings для MasterVoiceService */
export function setSettingsProvider(fn: () => import('../shared/types').Settings): void {
  getSettingsSnapshotImpl = fn
}

// Інцидент 25.08.2026: один uncaughtException у main = мовчазний exit(1),
// батч з 28 акаунтів замер назавжди, причини не було де шукати.
// Тож ловимо обидва, логуємо (→ dataDir/main.log) і тримаємо процес живим.
process.on('uncaughtException', (err): void => {
  console.error('[main] uncaughtException (процес продовжує жити):', err)
})
process.on('unhandledRejection', (reason): void => {
  console.error('[main] unhandledRejection (процес продовжує жити):', reason)
})

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    show: false,
    backgroundColor: '#1a1915',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1f1e1b',
      symbolColor: '#b8b5a9',
      height: 36
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true // вбудований двопанельний браузер (Gmail | Cartesia)
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => (mainWindow = null))

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const gotLock = process.env.CARTELSIA_E2E === '1' ? true : app.requestSingleInstanceLock()
if (!gotLock) {
  // 2.1.2: інший інстанс уже живий — це новий запуск «поверх».
  // Користувач хоче: вбити старий, запуститись далі. Старий інстанс отримає
  // 'second-instance' і сам підготується до виходу; тут просто виходимо,
  // а ЛОКЕР-файл полегшує старому інстансу зрозуміти, що його замінили.
  // Простіше і надійніше: фокусуємо наявне вікно (вторинний процес виходить),
  // а «вбити і перезапуститись» користувач робить закриттям + відкриттям.
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(() => {
    app.setAppUserModelId('com.cartelsia.app')

    // Файловий лог — першим: у production у console немає термінала
    setupMainLogging(dataDir())

    // 2.1.2: захист від «процес залишився у фоновому режимі»: singlе-instance lock
    // вже фокусує наявне вікно. Додатково ре-аранж kill залишкових Chromium
    // попереднього запуску робить registrar.close() у before-quit (killAll).
    void killOrphanChromium()

    // сервіси
    const client = new CartesiaClient()
    const ledger = new UsageLedger(dataDir())
    const pool = new KeyPool(dataDir(), client, ledger)
    const chats = new ChatStore()
    // спільні голоси (2.1): реєстр має бути готовий ДО scheduler'а (пребатч-гейт ревокації)
    const sharedRegistry = new SharedVoiceRegistry(dataDir(), client, () => {
      const pick = pool.listPublic().find((k) => k.status === 'active' && k.role !== 'clone')
      return pick ? pool.getRaw(pick.id)?.key : undefined
    })
    const ttsCache = new TtsCache(join(dataDir(), 'tts-cache'))
    const scheduler = new Scheduler(pool, client, chats, sharedRegistry, ttsCache)
    const voices = new VoicesService(dataDir(), client, pool)
    // мастер-клонування (2.0.1): геттер settings прийде з handlers через SERVICES-розширення
    const masterVoices = new MasterVoiceService(
      dataDir(),
      client,
      () => getSettingsSnapshot()
    )
    const registrar = new PlaywrightRegistrar()
    const clerkApiRegistrar = new ClerkApiRegistrar()
    const autoregService = new AutoregService(clerkApiRegistrar, pool)
    const proxyManager = new ProxyManager()
    proxyManager.persistPath = join(dataDir(), 'proxies.json')
    proxyManager.loadPersisted()
    autoregRef = autoregService

    handleMediaProtocol(voices)
    registerIpcHandlers(
      { pool, scheduler, chats, voices, ledger, client, registrar, clerkApiRegistrar, autoregService, proxyManager, masterVoices, sharedRegistry },
      () => mainWindow
    )
    pool.startTicking()

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', (e) => {
    // 2.1.2: повне прибирання при будь-якому виході: вбити браузери реєстрації,
    // зупинити проксі-чек, скинути стан. process.exit у listener забороняє 'before-quit',
    // тому синхронно робимо тільки те, що встигаємо.
    try { autoregRef?.interrupt('додаток закривається') } catch { /* ignore */ }
    void autoregRef?.stop().catch(() => {})
    flushAll()
  })

  app.on('window-all-closed', () => {
    // 2.1.2: закриття вікна = ПОВНИЙ вихід, навіть якщо автореєстрація активна
    // (вона переривається у before-quit: браузери вбиті, стан збережено).
    app.quit()
  })
}

/** 2.1.2: прибрати осиротілі Chromium попереднього запуску (Windows). */
async function killOrphanChromium(): Promise<void> {
  if (process.platform !== 'win32') return
  try {
    const { execFile } = await import('child_process')
    // не бʼємо ВСІ chrome.exe — тільки headless-діти цього юзера зі світ pref:
    // безпечний варіант: wmic за commandline ms-playwright (наш bundled Chromium)
    const out = await new Promise<string>((resolve) => {
      execFile(
        'wmic',
        ['process', 'where', "name='chrome.exe'", 'get', 'ProcessId,CommandLine', '/format:list'],
        { timeout: 8000 },
        (err: unknown, stdout: unknown) => resolve(err ? '' : String(stdout ?? ''))
      )
    })
    if (!out) return
    const blocks = out.split(/\n\n/)
    const pids: string[] = []
    for (const b of blocks) {
      if (/ms-playwright|cartelsia/i.test(b) && /--headless|--type=/i.test(b)) {
        const m = /ProcessId=(\d+)/.exec(b)
        if (m) pids.push(m[1])
      }
    }
    for (const pid of pids) {
      try { process.kill(Number(pid)) } catch { /* already dead */ }
    }
    if (pids.length) console.log(`[main] killOrphanChromium: убито ${pids.length} осиротілих Chromium`)
  } catch { /* best effort */ }
}
