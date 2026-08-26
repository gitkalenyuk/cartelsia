// Probe 5: скан усіх JS-чанків на фразу помилки / domeni check
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-gpu'] })
const ctx = await browser.newContext({ userAgent: UA })
const page = await ctx.newPage()
page.setDefaultTimeout(30000)
await page.goto('https://play.cartesia.ai/sign-in/create', { waitUntil: 'domcontentloaded', timeout: 45000 })
for (let i = 0; i < 10; i++) { await page.waitForTimeout(1500); if (!/checkpoint/i.test(await page.title())) break }
const chunkUrls = await page.evaluate(() => Array.from(document.querySelectorAll('script[src]')).map((s) => s.src).filter((u) => u.includes('/_next/static/chunks/')))
console.log('CHUNKS', chunkUrls.length)
const hits = []
const out = []
for (const u of chunkUrls) {
  let txt = ''
  try { txt = await page.evaluate((url) => fetch(url).then((r) => r.text()), u) } catch { continue }
  const name = u.split('/').pop().split('?')[0]
  out.push('### CHUNK ' + name + ' len=' + txt.length + '\n' + txt + '\n')
  if (txt.includes('not allowed')) hits.push(name + ' [not allowed]')
  if (/workos/i.test(txt)) hits.push(name + ' [workos]')
  if (/clerk/i.test(txt)) hits.push(name + ' [clerk]')
  const dom = txt.match(/allowedEmailDomains|allowed_email_domains|blockedEmailDomains|emailDomains[A-Za-z]*/g)
  if (dom) hits.push(name + ' [domains: ' + [...new Set(dom)].join(',') + ']')
}
writeFileSync(join(tmpdir(), 'cartelia_chunks_all.txt'), out.join(''))
console.log('HITS:\n' + hits.join('\n'))
await browser.close()
