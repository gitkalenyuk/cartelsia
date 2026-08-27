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

    // сервіси
    const client = new CartesiaClient()
    const ledger = new UsageLedger(dataDir())
    const pool = new KeyPool(dataDir(), client, ledger)
    const chats = new ChatStore()
    const scheduler = new Scheduler(pool, client, chats)
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
    autoregRef = autoregService

    handleMediaProtocol(voices)
    registerIpcHandlers(
      { pool, scheduler, chats, voices, ledger, client, registrar, clerkApiRegistrar, autoregService, proxyManager, masterVoices },
      () => mainWindow
    )
    pool.startTicking()

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', () => flushAll())

  app.on('window-all-closed', () => {
    // Батч посеред виконання — залишаємось у фоновому режимі, інакше
    // стан залишиться замороженим (в той самий патерн, що вбив інцидент).
    if (autoregRef?.isRunning()) {
      console.log('[main] window-all-closed, але автозареєстрація активна — не виходжуємо')
      return
    }
    if (process.platform !== 'darwin') app.quit()
  })
}
