import { _electron as electron } from 'playwright'
import { test, expect } from '@playwright/test'
import { mkdtempSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Перевірка ЗАПАКОВАНОГО додатку (asar): dist/win-unpacked/Cartelsia.exe.
// Portable-стаб Playwright не атачиться (розпаковується в %TEMP%) — його перевіряємо вручну.
const EXE = join(__dirname, '..', 'dist', 'win-unpacked', 'Cartelsia.exe')

test.skip(!existsSync(EXE), 'спершу зберіть додаток: npm run build:dir або build:win')

test('запакований додаток стартує, додає ключ і бачить голоси', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'cartelsia-packaged-'))
  const KEYS = JSON.parse(readFileSync('keys.local.json', 'utf8')).keys as string[]

  const app = await electron.launch({
    executablePath: EXE,
    env: { ...process.env, CARTELSIA_DATA_DIR: dataRoot, CARTELSIA_E2E: '1' }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  // вікно живе, сайдбар відрендерився
  await expect(page.getByTestId('new-generation')).toBeVisible()

  // ключ додається і проходить реальну валідацію
  await page.getByTestId('nav-keys').click()
  await page.getByTestId('keys-input').fill(KEYS[0])
  await page.getByTestId('keys-add-btn').click()
  await expect(page.getByTestId('key-status').first()).toHaveText('Активний', {
    timeout: 20_000
  })

  // бібліотека голосів вантажиться з реального API
  await page.getByTestId('new-generation').click()
  await page.getByTestId('voice-picker').click()
  await expect(page.locator('.popover__item').first()).toBeVisible({ timeout: 20_000 })

  await page.screenshot({ path: join(__dirname, '.artifacts', '10-packaged.png') })
  await app.close()

  // дані пішли в задану папку
  expect(existsSync(join(dataRoot, 'data', 'keys.json'))).toBe(true)
})
