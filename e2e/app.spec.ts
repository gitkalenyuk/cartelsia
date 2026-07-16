import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { test, expect } from '@playwright/test'
import { mkdtempSync, readFileSync, readdirSync, statSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// ~700 символів: 2 чанки при дефолтному розмірі 500
const TEXT = [
  'Колись давно, у невеликому селі біля лісу, жив старий пасічник. Щоранку він виходив до своїх вуликів і слухав, як гудуть бджоли. Це гудіння здавалося йому найкращою музикою на світі, кращою за будь-які пісні.',
  'Одного літнього дня до пасічника прийшов онук. Хлопчик довго дивився на вулики, а потім спитав, чому бджоли ніколи не відпочивають. Старий усміхнувся і відповів, що праця для бджоли і є відпочинком, коли робиш те, що любиш.',
  'З того часу хлопчик щоліта приїздив до діда. Він навчився розуміти бджіл, доглядати за вуликами і цінувати терплячу працю. А мед із дідової пасіки здавався йому найсолодшим у цілому світі.'
].join('\n\n')

const KEYS = JSON.parse(readFileSync('keys.local.json', 'utf8')).keys as string[]

let app: ElectronApplication
let page: Page
let dataRoot: string

const artifacts = join(__dirname, '.artifacts')
mkdirSync(artifacts, { recursive: true })

const shot = (name: string): Promise<Buffer> =>
  page.screenshot({ path: join(artifacts, `${name}.png`) })

test.beforeAll(async () => {
  dataRoot = mkdtempSync(join(tmpdir(), 'cartelsia-e2e-'))
  app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      CARTELSIA_DATA_DIR: dataRoot,
      CARTELSIA_E2E: '1'
    }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

test('повний сценарій: ключі → генерація → ротація → плеєр → мердж → заморозка', async () => {
  // ---------- 1. Додавання ключів ----------
  await page.getByTestId('nav-keys').click()
  await page.getByTestId('keys-input').fill(`${KEYS[0]}\n${KEYS[1]}`)
  await page.getByTestId('keys-add-btn').click()

  await expect(page.getByTestId('key-row')).toHaveCount(2, { timeout: 30_000 })
  const statuses = page.getByTestId('key-status')
  await expect(statuses.nth(0)).toHaveText('Активний', { timeout: 15_000 })
  await expect(statuses.nth(1)).toHaveText('Активний')
  await shot('01-keys-added')

  // ---------- 2. Обмежуємо ключ №1 через debug IPC (0 витрат API) ----------
  // remaining 400 < 500 → перший (більший) чанк піде на ключ №2, менший добʼє ключ №1
  const keyIds: string[] = await page.evaluate(async () => {
    const keys = await window.cartelsia.keys.list()
    return keys.map((k) => k.id)
  })
  await page.evaluate(
    async ({ id }) => {
      await window.cartelsia.debug.setKeyUsage(id, 19_600)
    },
    { id: keyIds[0] }
  )
  await expect(page.getByTestId('key-remaining').nth(0)).toHaveText('400')

  // ---------- 3. Композер: голос + текст ----------
  await page.getByTestId('new-generation').click()
  await page.getByTestId('voice-picker').click()
  const voiceRows = page.locator('.popover__item')
  await expect(voiceRows.first()).toBeVisible({ timeout: 20_000 })
  await voiceRows.first().click()

  await page.getByTestId('composer-text').fill(TEXT)
  await expect(page.getByTestId('char-counter')).toContainText('фрагмент')
  await shot('02-composer-filled')

  // ---------- 4. Підтвердження з розкладкою по ключах ----------
  await page.getByTestId('generate-btn').click()
  await expect(page.getByTestId('start-generation')).toBeVisible()
  await shot('03-confirm-dialog')
  await page.getByTestId('start-generation').click()

  // ---------- 5. Чанки генеруються паралельно і завершуються ----------
  await expect(page.getByTestId('chunk-card')).toHaveCount(2, { timeout: 15_000 })
  await expect(page.locator('[data-testid="chunk-card"][data-status="done"]')).toHaveCount(2, {
    timeout: 90_000
  })
  await shot('04-chunks-done')

  // ---------- 6. Ротація: чанки оброблені різними ключами ----------
  const keyLabels = await page.getByTestId('chunk-key-label').allTextContents()
  expect(new Set(keyLabels).size).toBe(2)

  // ---------- 7. Плеєр: аудіо реально грає ----------
  await page.locator('[data-testid="chunk-play"]').first().click()
  await page.waitForTimeout(1800)
  const timeText = await page.locator('.chunk__time').first().textContent()
  expect(timeText).not.toMatch(/^0:00 \//) // час пішов
  await shot('05-playing')

  // ---------- 8. Мердж в один файл ----------
  await page.getByTestId('download-all').click()
  await page.getByTestId('merge-confirm').click()
  // успіх закриває модалку (файл на диску вже записаний до цього моменту)
  await expect(page.getByTestId('merge-confirm')).toBeHidden({ timeout: 90_000 })

  const outputDir = join(dataRoot, 'output')
  const merged = readdirSync(outputDir).filter((f) => f.endsWith('.mp3'))
  expect(merged.length).toBe(1)
  const mergedSize = statSync(join(outputDir, merged[0])).size
  expect(mergedSize).toBeGreaterThan(20_000) // ~44 c мовлення @128kbps
  await shot('06-merged')

  // ---------- 9. Заморозка: remaining < 100 → статус + дата розморозки ----------
  await page.evaluate(
    async ({ id }) => {
      await window.cartelsia.debug.setKeyUsage(id, 19_950)
    },
    { id: keyIds[0] }
  )
  await page.getByTestId('nav-keys').click()
  await expect(page.getByTestId('key-status').nth(0)).toHaveText('Заморожений')
  await expect(page.getByTestId('unfreeze-date').first()).toContainText('через')
  await shot('07-frozen-key')

  // ---------- 10. Історія: чат зберігся в сайдбарі ----------
  await expect(page.getByTestId('chat-item').first()).toBeVisible()
})

test('переозвучка створює нову версію', async () => {
  await page.getByTestId('chat-item').first().click()
  await expect(page.locator('[data-testid="chunk-card"][data-status="done"]').first()).toBeVisible()

  const revoiceBtn = page.getByTestId('chunk-revoice').last()
  const card = page.locator('[data-testid="chunk-card"]').last()
  await card.hover()
  await revoiceBtn.click()

  await expect(card.locator('.version-chip')).toHaveCount(2, { timeout: 90_000 })
  await shot('08-revoice-versions')
})

test('невалідний ключ відхиляється', async () => {
  await page.getByTestId('nav-keys').click()
  await page.getByTestId('keys-input').fill('sk_car_bogus00000000000000000')
  await page.getByTestId('keys-add-btn').click()
  await expect(page.getByTestId('key-status').last()).toHaveText('Невалідний', {
    timeout: 20_000
  })
  await shot('09-invalid-key')
})
