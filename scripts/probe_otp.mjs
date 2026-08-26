import { chromium } from 'playwright'

const browser = await chromium.launch({
  headless: false,
  args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
})
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
})
const page = await ctx.newPage()
await page.goto('https://play.cartesia.ai/sign-in/create/verify-email-address', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)

const dump = await page.evaluate(() => {
  const inputs = Array.from(document.querySelectorAll('input')).map((i) => ({
    tag: i.tagName,
    type: i.type,
    name: i.name,
    id: i.id,
    placeholder: i.placeholder,
    value: i.value,
    maxLength: i.maxLength,
    autocomplete: i.autocomplete,
    inputMode: i.inputMode
  }))
  const allBtns = Array.from(document.querySelectorAll('button, input[type="submit"]'))
    .map((b) => ({
      tag: b.tagName,
      type: b.type,
      text: (b.textContent || b.value || '').trim()
    }))
  const body = (document.body ? document.body.innerHTML : '').slice(0, 4500)
  return { url: location.href, inputs, allBtns, body }
})
console.log(JSON.stringify(dump, null, 2))
await browser.close()