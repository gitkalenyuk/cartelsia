import { chromium } from "playwright"
const H = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
const t0 = Date.now()
const ts = (ms)=> '['+((ms)/1000).toFixed(1)+'s] '
const browser = await chromium.launch({ headless: true, args:["--disable-blink-features=AutomationControlled","--no-sandbox","--disable-gpu"] })
const ctx = await browser.newContext({ userAgent: H })
const page = await ctx.newPage()
page.setDefaultTimeout(60000)
// instrument ALL requests/responses to protect.clerk.com
await page.route('**/*', (route) => { const u=route.request().url(); if(/protect\.clerk\.com/.test(u)) console.log(ts(Date.now()-t0)+'REQ ', route.request().method(), u.slice(0,120)); return route.continue() })
page.on('response', (res)=>{ const u=res.url(); if(/protect\.clerk\.com/.test(u)) console.log(ts(Date.now()-t0)+'RES ', res.status(), u.length>1? 'POST?' : u.slice(0,80), (res.request().method())) })
// specifically watch the probe REPORT (POST with body)
page.on('request', (req)=>{ if(/\/probe$/.test(req.url()) && req.method()==='POST') console.log(ts(Date.now()-t0)+'>> PROBE REPORT POST sent, bodylen='+req.postData().length) })
await page.goto("https://play.cartesia.ai/sign-in/create", { waitUntil: "domcontentloaded", timeout: 60000 })
console.log(ts(Date.now()-t0)+'page loaded, title='+(await page.title()).slice(0,50))
for (let i=0;i<40 && !(await page.evaluate(()=>!!window.__clerk_specter)); i++) await page.waitForTimeout(500)
console.log(ts(Date.now()-t0)+'specter ready in DOM, cid='+(await page.evaluate(()=>window.__clerk_specter&&window.__clerk_specter.cid)))
// NOW wait 12s to let fire-and-forget probes finish + report
console.log(ts(Date.now()-t0)+'waiting 12s for probe report...')
await page.waitForTimeout(12000)
console.log(ts(Date.now()-t0)+'probes settled')
await browser.close()
console.log(ts(Date.now()-t0)+'DONE')
