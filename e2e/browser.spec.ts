import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { test, expect } from '@playwright/test'
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'

let app: ElectronApplication
let page: Page
let dataRoot: string

const artifacts = join(__dirname, '.artifacts')
mkdirSync(artifacts, { recursive: true })

test.beforeAll(async () => {
  dataRoot = mkdtempSync(join(tmpdir(), 'cartelsia-browser-'))
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, CARTELSIA_DATA_DIR: dataRoot, CARTELSIA_E2E: '1' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  // webview з реальними сайтами закривається повільно — розвантажуємо і форсуємо
  try {
    await page.evaluate(() => {
      document.querySelectorAll('webview').forEach((w) => {
        try {
          ;(w as unknown as { loadURL(u: string): void }).loadURL('about:blank')
        } catch {
          /* ignore */
        }
      })
    })
  } catch {
    /* ignore */
  }
  await Promise.race([app?.close(), new Promise((r) => setTimeout(r, 8000))])
  try {
    app?.process()?.kill()
  } catch {
    /* ignore */
  }
})

test('вкладка «Браузер»: дві панелі, тулбари, кнопка забору ключа', async () => {
  await page.getByTestId('nav-browser').click()
  await expect(page.getByTestId('pane-mail')).toBeVisible()
  await expect(page.getByTestId('pane-cartesia')).toBeVisible()
  // два вбудовані браузери
  await expect(page.locator('webview')).toHaveCount(2)
  await expect(page.getByTestId('grab-key')).toBeVisible()
  await page.screenshot({ path: join(artifacts, '15-browser.png') })
})

test('забір ключа зі сторінки додає його в пул', async () => {
  // локальна тест-сторінка з повним фейковим ключем (як дашборд Cartesia при створенні)
  const html =
    '<html><body><h1>API Keys</h1><pre>sk_car_TESTKEY000000000000000001</pre></body></html>'
  const file = join(dataRoot, 'fake-dashboard.html')
  writeFileSync(file, html, 'utf8')
  const fileUrl = pathToFileURL(file).toString()

  const urlBar = page.getByTestId('pane-cartesia').locator('.bpane__url')
  await urlBar.fill(fileUrl)
  await urlBar.press('Enter')
  await page.waitForTimeout(1500) // webview завантажує сторінку

  await page.getByTestId('grab-key').click()
  await expect(page.locator('.toast--success')).toBeVisible({ timeout: 15_000 })

  // ключ реально доданий у пул
  const keys = await page.evaluate(() => window.cartelsia.keys.list())
  expect(keys.some((k) => k.keyMasked.startsWith('sk_car_'))).toBe(true)
  await page.screenshot({ path: join(artifacts, '16-grabbed-key.png') })
})
