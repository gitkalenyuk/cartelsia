// Знайти реальний URL attempt_completion у Clerk JS 6.30.1 (ресурси, завантажені на sign-in сторінці)
import { chromium } from 'playwright'
import { writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-gpu'] })
const ctx = await browser.newContext({ userAgent: UA })
const page = await ctx.newPage()
page.setDefaultTimeout(30000)
await page.goto('https://play.cartesia.ai/sign-in/create', { waitUntil: 'domcontentloaded', timeout: 45000 })
await page.waitForTimeout(8000)
const urls = await page.evaluate(() => performance.getEntriesByType('resource').map(r => r.name))
const jsUrls = [...new Set(urls.filter(u => /\.(js|mjs)(\?|$)/.test(u) || u.includes('chunk')))].filter(u => !/googletagmanager|vite|vercel|sentry|typeform|posthog|analytics/i.test(u))
console.log('JS resources:', jsUrls.length)
jsUrls.forEach(u => console.log('  ', u.slice(0, 150)))
const found = []
for (const u of jsUrls) {
  let txt = ''
  try { txt = await page.evaluate((url) => fetch(url).then(r => r.text()), u) } catch { continue }
  if (txt.includes('completion') || txt.includes('sign_ups')) {
    found.push([u, txt.length])
    const hits = []
    let i = 0
    while ((i = txt.indexOf('completion', i)) >= 0 && hits.length < 12) { hits.push(txt.slice(Math.max(0, i - 140), i + 140)); i += 10 }
    console.log('\n### MATCH ' + u + ' len=' + txt.length)
    hits.forEach(h => console.log('   ...' + h.replace(/\n/g, ' ') + '...\n'))
    writeFileSync(join(tmpdir(), 'clerk_chunk_' + (found.length) + '.js'), txt)
  }
}
console.log('\nFOUND:', found.length)
await browser.close()
