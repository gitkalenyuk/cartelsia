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
  const allBtns = Array.from(document.querySelectorAll('button, input[type="submit"], a[role="button"]'))
    .map((b) => ({
      tag: b.tagName,
      type: b.type,
      text: (b.textContent || b.value || '').trim(),
      raw: (b.innerHTML || '').slice(0, 120)
    }))
  const forms = Array.from(document.querySelectorAll('form')).map((f) => ({
    action: f.action,
    method: f.method,
    visible: !!f.offsetParent
  }))
  const iframes = Array.from(document.querySelectorAll('iframe')).map((i) => ({
    src: i.src,
    title: i.title,
    visible: !!i.offsetParent
  }))
  const bodyText = (document.body ? document.body.innerText : '').slice(0, 2000)
  return { url: location.href, forms, inputs, allBtns, iframes, bodyText }
})
console.log(JSON.stringify(dump, null, 2))
await browser.close()