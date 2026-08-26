// Probe 6: kaleny.uk — ВСІ запити без фільтрів, повні відповіді
import { chromium } from 'playwright'
import { writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
const email = 'probe6_' + Date.now().toString(36) + '@kaleny.uk'
const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-gpu'] })
const ctx = await browser.newContext({ userAgent: UA })
const page = await ctx.newPage()
page.setDefaultTimeout(30000)
const log = []
page.on('request', (req) => {
  const u = req.url()
  if (u.includes('/_next/static') || u.includes('.woff2')) return
  log.push('REQ ' + req.method() + ' ' + u.slice(0, 200))
})
page.on('response', async (res) => {
  const u = res.url()
  if (u.includes('/_next/static') || u.includes('.woff2') || u.includes('datadog')) return
  let body = ''
  try { body = (await res.text()).slice(0, 1200) } catch {}
  log.push('RES ' + res.status() + ' ' + u.slice(0, 200) + ' BODY=' + body)
})
await page.goto('https://play.cartesia.ai/sign-in/create', { waitUntil: 'domcontentloaded', timeout: 45000 })
for (let i = 0; i < 10; i++) { await page.waitForTimeout(1500); if (!/checkpoint/i.test(await page.title())) break }
await page.waitForTimeout(1200)
const before = log.length
await page.evaluate(([em, pw]) => {
  function setVal(el, val) {
    if (!el) return
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    if (d && d.set) d.set.call(el, val); else el.value = val
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const vis = Array.from(document.querySelectorAll('input')).filter((i) => i.type !== 'hidden')
  setVal(vis[0], 'Alex'); setVal(vis[1], 'Cartel'); setVal(vis[2], em); setVal(vis[3], pw)
}, [email, 'Probe_Ab12cd!9'])
await page.waitForTimeout(400)
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button, input[type="submit"]'))
  const c = btns.find((b) => (b.textContent || '').trim().toLowerCase() === 'continue')
  if (c) c.click()
})
await page.waitForTimeout(10000)
console.log('EMAIL', email)
console.log('REQUESTS_AFTER_PAGE_LOAD: ' + (log.length - before))
for (const l of log.slice(before)) console.log(l)
writeFileSync(join(tmpdir(), 'cartelia_probe6.log'), log.join('\n'))
await browser.close()
