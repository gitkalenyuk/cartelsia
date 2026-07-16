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
import { registerIpcHandlers } from './ipc/handlers'

registerMediaScheme()

let mainWindow: BrowserWindow | null = null

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

    // сервіси
    const client = new CartesiaClient()
    const ledger = new UsageLedger(dataDir())
    const pool = new KeyPool(dataDir(), client, ledger)
    const chats = new ChatStore()
    const scheduler = new Scheduler(pool, client, chats)
    const voices = new VoicesService(dataDir(), client, pool)

    handleMediaProtocol(voices)
    registerIpcHandlers({ pool, scheduler, chats, voices, ledger, client }, () => mainWindow)
    pool.startTicking()

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', () => flushAll())

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
