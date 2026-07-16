import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { test, expect } from '@playwright/test'
import { mkdtempSync, readFileSync, mkdirSync, readdirSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const KEYS = JSON.parse(readFileSync('keys.local.json', 'utf8')).keys as string[]

let app: ElectronApplication
let page: Page
let dataRoot: string

const artifacts = join(__dirname, '.artifacts')
mkdirSync(artifacts, { recursive: true })

test.beforeAll(async () => {
  dataRoot = mkdtempSync(join(tmpdir(), 'cartelsia-v11-'))
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, CARTELSIA_DATA_DIR: dataRoot, CARTELSIA_E2E: '1' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  // ключі для всіх тестів
  await page.getByTestId('nav-keys').click()
  await page.getByTestId('keys-input').fill(`${KEYS[0]}\n${KEYS[1]}`)
  await page.getByTestId('keys-add-btn').click()
  await expect(page.getByTestId('key-row')).toHaveCount(2, { timeout: 30_000 })
})

test.afterAll(async () => {
  await app?.close()
})

test('скелет YT CARTEL і телеграм-кнопки в сайдбарі', async () => {
  await expect(page.locator('.skull-svg')).toBeVisible()
  await expect(page.locator('.skull-caption')).toHaveText('YT CARTEL')
  await expect(page.locator('.tg-btn')).toHaveCount(2)
  await page.screenshot({ path: join(artifacts, '11-skull-sidebar.png') })
})

test('оригінальний семпл голосу качається і грає', async () => {
  await page.getByTestId('nav-voices').click()
  const playBtn = page.getByTestId('voice-sample-play').first()
  await expect(playBtn).toBeVisible({ timeout: 20_000 })
  await playBtn.click()
  // спінер зникає, помилки немає → семпл скачано (з авторизацією) і він грає
  await expect(page.locator('.toast--danger')).toHaveCount(0)
  await expect(playBtn.locator('.spinner')).toHaveCount(0, { timeout: 20_000 })
  await page.waitForTimeout(700)
  await expect(page.locator('.toast--danger')).toHaveCount(0)
  // кеш зʼявився на диску
  const previews = readdirSync(join(dataRoot, 'data', 'previews'))
  expect(previews.length).toBeGreaterThan(0)
  await page.screenshot({ path: join(artifacts, '12-sample-playing.png') })
})

test('генерація семплу для голосу без превʼю (укр. фраза)', async () => {
  const voice = await page.evaluate(async () => {
    const res = await window.cartelsia.voices.list({ limit: 100 })
    return res.data.find((v) => !v.previewUrl)?.id ?? null
  })
  test.skip(!voice, 'усі голоси на сторінці мають превʼю')
  const result = await page.evaluate(
    async ({ id }) => window.cartelsia.voices.getPreview({ voiceId: id, language: 'uk' }),
    { id: voice! }
  )
  expect(result.generated).toBe(true)
  expect(existsSync(join(dataRoot, 'data', 'previews', result.file))).toBe(true)
  // повторний виклик — з кешу (та сама назва файла)
  const cached = await page.evaluate(
    async ({ id }) => window.cartelsia.voices.getPreview({ voiceId: id, language: 'uk' }),
    { id: voice! }
  )
  expect(cached.file).toBe(result.file)
})

test('прапорці мов у композері', async () => {
  await page.getByTestId('new-generation').click()
  await page.locator('.pill', { hasText: 'Мова' }).click()
  await expect(page.locator('.popover__item', { hasText: '🇺🇦 Українська' })).toBeVisible()
  await page.locator('.popover__item', { hasText: '🇺🇦 Українська' }).click()
  await expect(page.locator('.pill', { hasText: '🇺🇦' })).toBeVisible()
  await page.screenshot({ path: join(artifacts, '13-flags.png') })
})

test('вкладка «Клон голосу»: клон-ключ + сканування', async () => {
  await page.getByTestId('nav-clone').click()
  await expect(page.getByTestId('clone-key-input')).toBeVisible()
  await page.getByTestId('clone-key-input').fill(KEYS[2])
  await page.getByTestId('clone-key-add').click()
  // додавання тригерить авто-скан; чекаємо результат
  await expect(page.locator('.toast--success').first()).toBeVisible({ timeout: 40_000 })
  await page.screenshot({ path: join(artifacts, '14-clone-tab.png') })

  // клон-ключ НЕ зʼявляється в загальному пулі
  await page.getByTestId('nav-keys').click()
  await expect(page.getByTestId('key-row')).toHaveCount(2)
})

test('кнопка «Клонувати голос» веде на вкладку клонів', async () => {
  await page.getByTestId('nav-voices').click()
  await page.getByTestId('open-clone-tab').click()
  await expect(page.getByTestId('clone-key-input')).toBeVisible()
})
