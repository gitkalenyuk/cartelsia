// Probe 3: тест кількох email-варіантів + точний лог play.cartesia.ai XHR
import { chromium } from 'playwright'
import { writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
const ts = Date.now().toString(36)
const rnd = () => Math.random().toString(36).slice(2, 6)
const tests = [
  { name: 'cartelia-own-domain', email: 'cartelia_' + ts + '_' + rnd() + '@kaleny.uk' },
  { name: 'probestyle-own-domain', email: 'probe_' + ts + '_' + rnd() + '@kaleny.uk' },
  { name: 'gmail', email: 'nonexistentuser92' + rnd() + '@gmail.com' },
]
const pass = 'Probe_Ab12cd!9'

const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-gpu'] })

for (const t of tests) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, userAgent: UA, locale: 'en-US' })
  const page = await ctx.newPage()
  page.setDefaultTimeout(30000)
  const xh = []
  page.on('request', (req) => {
    const u = req.url()
    if (u.includes('play.cartesia.ai/api') || u.includes('workos.com') || u.includes('identity.')) xh.push('REQ ' + req.method() + ' ' + u.slice(0, 160) + (req.postData() ? ' PD=' + req.postData().slice(0, 300) : ''))
  })
  page.on('response', async (res) => {
    const u = res.url()
    if (u.includes('play.cartesia.ai/api') || u.includes('workos.com') || u.includes('identity.')) {
      let body = ''
      try { body = (await res.text()).slice(0, 400) } catch {}
      xh.push('RES ' + res.status() + ' ' + u.slice(0, 160) + ' BODY=' + body)
    }
  })
  await page.goto('https://play.cartesia.ai/sign-in/create', { waitUntil: 'domcontentloaded', timeout: 45000 })
  for (let i = 0; i < 10; i++) { await page.waitForTimeout(1500); if (!/checkpoint/i.test(await page.title())) break }
  await page.waitForTimeout(1500)
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
  }, ['Alex', 'Cartel', t.email, pass])
  await page.waitForTimeout(400)
  const t0 = Date.now()
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, input[type="submit"]'))
    const c = btns.find((b) => (b.textContent || '').trim().toLowerCase() === 'continue')
    if (c) c.click()
  })
  // чекаємо появи повідомлення про помилку або зміну URL до 12с
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(1000)
    const st = await page.evaluate(() => ({ url: location.href, body: (document.body ? document.body.innerText : '') }))
    if (st.url !== 'https://play.cartesia.ai/sign-in/create') { console.log('[' + t.name + '] URL_CHANGED after ' + (Date.now() - t0) + 'ms ->', st.url); break }
    if (/not allowed/i.test(st.body)) { console.log('[' + t.name + '] NOT_ALLOWED after ' + (Date.now() - t0) + 'ms'); break }
    if (/valid first name|valid email|Password must|already exists/i.test(st.body)) { console.log('[' + t.name + '] VALIDATION: ' + st.body.slice(0, 200).replace(/\n/g, ' | ')); break }
  }
  const st2 = await page.evaluate(() => ({ url: location.href, body: (document.body ? document.body.innerText : '').slice(0, 300) }))
  console.log('[' + t.name + '] FINAL url=' + st2.url + ' body=' + st2.body.replace(/\n/g, ' | ').slice(0, 250))
  console.log('[' + t.name + '] XHR:'); xh.forEach((l) => console.log('   ', l))
  await ctx.close()
}
writeFileSync(join(tmpdir(), 'cartelia_probe3.log'), tests.map((t) => t.name + ' ' + t.email).join('\n'))
await browser.close()
