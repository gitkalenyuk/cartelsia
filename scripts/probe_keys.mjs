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
await page.goto('https://play.cartesia.ai/keys', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)
const dump = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button, a')).map((b) => ({
    tag: b.tagName,
    type: b.type,
    text: (b.textContent || '').trim().slice(0, 60),
    href: b.href
  }))
  const inputs = Array.from(document.querySelectorAll('input')).map((i) => ({
    name: i.name,
    id: i.id,
    type: i.type,
    placeholder: i.placeholder
  }))
  const bodyText = (document.body ? document.body.innerText : '').slice(0, 4000)
  return { url: location.href, btns, inputs, bodyText }
})
console.log(JSON.stringify(dump, null, 2))
await browser.close()