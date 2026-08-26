// Probe: headless мережеві виклики play.cartesia.ai
// Запуск: node scripts/probe_headless_net.mjs
import { chromium } from 'playwright'
import { writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

const browser = await chromium.launch({
  headless: true,
  args: [
    '--disable-blink-features=AutomationControlled',
    '--no-sandbox',
    '--disable-web-security',
    '--disable-dev-shm-usage',
    '--disable-gpu',
  ],
})

const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  userAgent: UA,
  locale: 'en-US',
})
const page = await ctx.newPage()
page.setDefaultTimeout(30000)

const interesting = []
page.on('request', (req) => {
  const u = req.url()
  if (u.includes('/api/') || u.includes('workos') || u.includes('cartesia.ai')) {
    interesting.push({ m: req.method(), u: u.slice(0, 200), pd: (req.postData() || '').slice(0, 300) })
  }
})

let finalUrl = ''
let landed = false
try {
  await page.goto('https://play.cartesia.ai/sign-in/create', { waitUntil: 'domcontentloaded', timeout: 45000 })
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(2000)
    const title = await page.title()
    if (!/checkpoint/i.test(title)) { landed = true; break }
  }
} catch (e) {
  console.log('GOTO_ERR', e.message.slice(0, 200))
}
finalUrl = page.url()
console.log('FINAL_URL', finalUrl, 'landed=', landed)
await page.waitForTimeout(3000)

const dump = await page
  .evaluate(() => {
    const doc = document
    const scripts = Array.from(doc.querySelectorAll('script[src]')).map((s) => s.src)
    return {
      title: doc.title,
      bodyText: (doc.body ? doc.body.innerText : '').slice(0, 1200),
      scriptCount: scripts.length,
      scripts: scripts.slice(0, 60),
      htmlLen: doc.documentElement.outerHTML.length,
      inlineNextData: (doc.documentElement.outerHTML.match(/__NEXT_DATA__|self.__next_f/g) || []).length,
    }
  })
  .catch((e) => ({ err: String(e) }))
console.log('PAGE_DUMP', JSON.stringify(dump, null, 1).slice(0, 4000))

const found = { clientIds: new Set(), apiRoutes: new Set(), markers: new Set() }
const chunkUrls = (dump.scripts || []).filter((u) => u.includes('/_next/static/chunks/'))
for (const u of chunkUrls.slice(0, 40)) {
  try {
    const txt = await page.evaluate((url) => fetch(url).then((r) => r.text()), u)
    const cid = txt.match(/clientId[=:]\s*["'][A-Za-z0-9._-]{6,}["']/g) || []
    for (const c of cid) found.clientIds.add(c)
    const wos = txt.match(/workos[a-z_-]*/gi) || []
    for (const w of wos.slice(0, 10)) found.markers.add(w)
    const routes = txt.match(/["'][\/]{1,2}api\/[a-z0-9_/-]{3,40}["']/gi) || []
    for (const r of routes.slice(0, 30)) found.apiRoutes.add(r)
    if (txt.includes('workos')) console.log('CHUNK_HAS_WORKOS', u.split('/').pop())
  } catch (e) {
    /* ignore */
  }
}
console.log('CLIENT_IDS', [...found.clientIds].join(' | '))
console.log('API_ROUTES', [...found.apiRoutes].slice(0, 40).join(' | '))
console.log('WORKOS_MARKERS', [...found.markers].slice(0, 20).join(' | '))
console.log('INTERESTING_REQUESTS', JSON.stringify(interesting.slice(0, 60), null, 1).slice(0, 3000))

const cookies = await ctx.cookies()
writeFileSync(join(tmpdir(), 'cartelia_probe_cookies.json'), JSON.stringify(cookies, null, 1))
console.log('COOKIES', cookies.map((c) => c.name + '@' + c.domain).join(', '))

await browser.close()
