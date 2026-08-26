// Probe 4: ВСІ мережеві запити (включно RSC server action) + повний HTML
import { chromium } from 'playwright'
import { writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
const email = 'probe4_' + Date.now().toString(36) + '@gmail.com'
const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-gpu'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, userAgent: UA, locale: 'en-US' })
const page = await ctx.newPage()
page.setDefaultTimeout(30000)
const log = []
page.on('request', (req) => {
  const u = req.url()
  if (u.includes('datadog') || u.includes('/_next/static') || u.includes('.woff2')) return
  log.push({ t: 'req', m: req.method(), u: u.slice(0, 220), hdr: { na: req.headers()['next-action'] || req.headers()['next-router-prefetch'] }, pd: (req.postData() || '').slice(0, 800) })
})
page.on('response', async (res) => {
  const u = res.url()
  if (u.includes('datadog') || u.includes('/_next/static') || u.includes('.woff2')) return
  let body = ''
  try { body = (await res.text()).slice(0, 800) } catch {}
  log.push({ t: 'res', s: res.status(), u: u.slice(0, 220), ct: res.headers()['content-type'] || '', body })
})
await page.goto('https://play.cartesia.ai/sign-in/create', { waitUntil: 'domcontentloaded', timeout: 45000 })
for (let i = 0; i < 10; i++) { await page.waitForTimeout(1500); if (!/checkpoint/i.test(await page.title())) break }
await page.waitForTimeout(1500)
const html = await page.evaluate(() => document.documentElement.outerHTML)
writeFileSync(join(tmpdir(), 'cartelia_probe4.html'), html)
console.log('HTML_SAVED len=' + html.length)
const wos = (html.match(/workos[a-z0-9_.-]{0,30}/gi) || [])
console.log('HTML_WORKOS', [...new Set(wos)].slice(0, 20).join(' | '))
const cid = (html.match(/client[_-]?id["'=:\s]+[A-Za-z0-9_-]{6,}/gi) || [])
console.log('HTML_CLIENTID', [...new Set(cid)].slice(0, 10).join(' | '))

await page.evaluate(([fn, ln, em, pw]) => {
  function setVal(el, val) {
    if (!el) return
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    if (d && d.set) d.set.call(el, val); else el.value = val
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const vis = Array.from(document.querySelectorAll('input')).filter((i) => i.type !== 'hidden')
  setVal(vis[0], fn); setVal(vis[1], ln); setVal(vis[2], em); setVal(vis[3], pw)
}, ['Alex', 'Cartel', email, 'Probe_Ab12cd!9'])
await page.waitForTimeout(400)
const before = log.length
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button, input[type="submit"]'))
  const c = btns.find((b) => (b.textContent || '').trim().toLowerCase() === 'continue')
  if (c) c.click()
})
await page.waitForTimeout(12000)
const after = await page.evaluate(() => ({ url: location.href, body: (document.body ? document.body.innerText : '').slice(0, 200) }))
console.log('AFTER url=' + after.url + ' body=' + after.body.replace(/\n/g, ' | '))
console.log('NEW_REQUESTS_SINCE_CLICK: ' + (log.length - before))
for (const l of log.slice(before)) {
  console.log('  ' + l.t + ' ' + (l.m || l.s) + ' ' + l.u + (l.ct ? ' [' + l.ct.split(';')[0] + ']' : '') + (l.pd ? ' PD=' + l.pd : '') + (l.body ? ' BODY=' + l.body : ''))
}
writeFileSync(join(tmpdir(), 'cartelia_probe4.log'), JSON.stringify(log, null, 1))
await browser.close()
