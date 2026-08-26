// Probe 2: повний скан JS-чанків + сабміт форми з логуванням XHR
import { chromium } from 'playwright'
import { writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
const email = process.argv[2] || ('probe_' + Date.now().toString(36) + '@kaleny.uk')
const pass = (process.argv[3] || 'Probe_Ab12cd!9')

const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-gpu'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, userAgent: UA, locale: 'en-US' })
const page = await ctx.newPage()
page.setDefaultTimeout(30000)

const xh = []
page.on('request', (req) => {
  const u = req.url()
  if (u.includes('/api/') || u.includes('workos') || u.includes('identity.')) xh.push({ t: 'req', m: req.method(), u: u.slice(0, 180), pd: (req.postData() || '').slice(0, 400) })
})
page.on('response', async (res) => {
  const u = res.url()
  if (u.includes('/api/') || u.includes('workos') || u.includes('identity.')) {
    let body = ''
    try { body = (await res.text()).slice(0, 600) } catch {}
    xh.push({ t: 'res', s: res.status(), u: u.slice(0, 180), body })
  }
})

await page.goto('https://play.cartesia.ai/sign-in/create', { waitUntil: 'domcontentloaded', timeout: 45000 })
for (let i = 0; i < 10; i++) { await page.waitForTimeout(1500); if (!/checkpoint/i.test(await page.title())) break }
console.log('LANDED', page.url())
await page.waitForTimeout(2000)

// Скан ВСІХ чанків
const chunkUrls = await page.evaluate(() => Array.from(document.querySelectorAll('script[src]')).map((s) => s.src).filter((u) => u.includes('/_next/static/chunks/')))
console.log('CHUNK_COUNT', chunkUrls.length)
const workosChunks = []
const idHits = []
const routeHits = new Set()
for (const u of chunkUrls) {
  let txt = ''
  try { txt = await page.evaluate((url) => fetch(url).then((r) => r.text()), u) } catch { continue }
  const low = txt.toLowerCase()
  if (low.includes('workos')) workosChunks.push(u.split('/').pop())
  for (const m of txt.matchAll(/client_?id["'s:=]+([A-Za-z0-9_.-]{8,})/gi)) idHits.push(m[0].slice(0, 60))
  for (const m of txt.matchAll(/["'](?:\/api\/[a-z0-9_\/-]+|\/[a-z0-9_\/-]*verify[a-z0-9_\/-]*)["']/gi)) routeHits.add(m[0])
}
console.log('WORKOS_CHUNKS', workosChunks.join(', '))
console.log('CLIENT_ID_HITS', [...new Set(idHits)].slice(0, 15).join(' | '))
console.log('ROUTE_HITS', [...routeHits].slice(0, 30).join(' | '))

// Заповнюємо форму та сабмітимо
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
}, ['Alex', 'Cartel', email, pass])
await page.waitForTimeout(500)
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button, input[type="submit"]'))
  const c = btns.find((b) => (b.textContent || '').trim().toLowerCase() === 'continue')
  if (c) c.click()
})
console.log('SUBMITTED for', email)
// слідуємо за поведінкою до 40с
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(2000)
  const t = await page.evaluate(() => ({ url: location.href, body: (document.body ? document.body.innerText : '').slice(0, 400) }))
  console.log('T+' + (i + 1) * 2 + ' url=' + t.url + ' body=' + t.body.replace(/\n/g, ' | ').slice(0, 300))
  if (t.url.includes('verify') || t.url.includes('confirm')) break
}
console.log('XHR_LOG ' + JSON.stringify(xh.slice(0, 80)).slice(0, 9000))
writeFileSync(join(tmpdir(), 'cartelia_probe2.log'), JSON.stringify(xh, null, 1))
await browser.close()
