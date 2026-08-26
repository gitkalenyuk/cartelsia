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
await page.goto('https://play.cartesia.ai/sign-in/create', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
const dump = await page.evaluate(() => {
  const inputs = Array.from(document.querySelectorAll('input')).map((i) => ({
    name: i.name,
    id: i.id,
    type: i.type,
    placeholder: i.placeholder
  }))
  const forms = document.querySelectorAll('form').length
  const allBtns = Array.from(
    document.querySelectorAll('button, input[type="submit"], a[role="button"]')
  ).map((b) => ({
    tag: b.tagName,
    type: b.type,
    text: ((b.textContent || b.value) || '').trim().slice(0, 60),
    role: b.getAttribute('role')
  }))
  const htmlSnippet = (document.body && document.body.innerHTML || '').slice(0, 6000)
  return { url: location.href, forms, inputs, allBtns, htmlSnippet }
})
console.log(JSON.stringify(dump, null, 2))
await browser.close()