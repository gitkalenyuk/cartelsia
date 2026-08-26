import { chromium } from 'playwright'
import tls from 'tls'
import { readFileSync, appendFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

const settings = JSON.parse(readFileSync('dist/data/settings.json', 'utf8'))
const DATA_DIR = 'dist/data'

let totalOk = 0
let totalFail = 0

function genEmail() {
  const time = Date.now().toString(36)
  const rnd = Math.random().toString(36).slice(2, 6)
  return `cartelia_${time}_${rnd}@${settings.catchAllDomain}`
}
function genPass() {
  const upper = Array.from({ length: 5 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)]).join('')
  const digits = Array.from({ length: 2 }, () => '0123456789'[Math.floor(Math.random() * 10)]).join('')
  const lower = Array.from({ length: 2 }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]).join('')
  return `Cartelia_${upper}${digits}${lower}!9`
}

function fetchOtpForEmail(targetEmail, startTime) {
  return new Promise((resolve) => {
    const sock = tls.connect({ host: settings.imapConfig.host || 'imap.gmail.com', port: settings.imapConfig.port || 993, rejectUnauthorized: false, servername: settings.imapConfig.host })
    let buf = ''
    let stage = 'CONNECT'
    let otp = null
    sock.setEncoding('utf8')
    const to = setTimeout(() => { sock.destroy(); resolve(null) }, 20000)
    sock.on('data', (d) => {
      buf += d
      if (stage === 'CONNECT' && buf.includes('* OK')) { stage = 'LOGIN'; buf = ''; sock.write(`A1 LOGIN "${settings.imapConfig.user}" "${settings.imapConfig.pass}"\r\n`) }
      else if (stage === 'LOGIN' && buf.includes('A1 OK')) { stage = 'SELECT'; buf = ''; sock.write(`A2 SELECT INBOX\r\n`) }
      else if (stage === 'SELECT' && buf.includes('A2 OK')) {
        stage = 'SEARCH'; buf = ''
        const since = new Date(startTime - 60000)
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
        const ds = `${String(since.getDate()).padStart(2,'0')}-${months[since.getMonth()]}-${since.getFullYear()}`
        sock.write(`A3 UID SEARCH SINCE ${ds} FROM "cartesia.ai"\r\n`)
      }
      else if (stage === 'SEARCH' && buf.includes('A3 OK')) {
        let uids = []
        // Parse * SEARCH line robustly
        const lines = buf.split('\r\n')
        for (const line of lines) if (line.startsWith('* SEARCH')) uids = line.slice(8).trim().split(/\s+/).filter(Boolean).filter(x=>/^\d+$/.test(x))
        if (!uids.length) {
          // fallback without FROM
          stage = 'SEARCH2'; buf = ''
          const since = new Date(startTime - 60000)
          const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
          const ds = `${String(since.getDate()).padStart(2,'0')}-${months[since.getMonth()]}-${since.getFullYear()}`
          sock.write(`A3b UID SEARCH SINCE ${ds}\r\n`)
          return
        }
        stage = 'FETCH'; buf = ''
        sock.write(`A4 UID FETCH ${uids.slice(-20).join(',')} (BODY[TEXT] BODY[HEADER.FIELDS (SUBJECT TO FROM)])\r\n`)
      }
      else if (stage === 'SEARCH2' && buf.includes('A3b OK')) {
        let uids = []
        const lines = buf.split('\r\n')
        for (const line of lines) if (line.startsWith('* SEARCH')) uids = line.slice(8).trim().split(/\s+/).filter(Boolean).filter(x=>/^\d+$/.test(x))
        if (!uids.length) { clearTimeout(to); sock.end(); resolve(null); return }
        stage = 'FETCH'; buf = ''
        sock.write(`A4 UID FETCH ${uids.slice(-20).join(',')} (BODY[TEXT] BODY[HEADER.FIELDS (SUBJECT TO FROM)])\r\n`)
      }
      else if (stage === 'FETCH' && buf.includes('A4 OK')) {
        clearTimeout(to); sock.end()
        const msgs = buf.split(/\* \d+ FETCH/i)
        // Walk newest first
        for (let i = msgs.length - 1; i >= 0; i--) {
          const msg = msgs[i]
          if (!msg) continue
          const lowered = msg.toLowerCase()
          if (!lowered.includes(targetEmail.toLowerCase()) && !lowered.includes('cartesia')) continue
          // Try base64 decode detection: if body looks b64, decode
          let decoded = msg
          // Handle quoted-printable =XX and =\\r\\n
          decoded = decoded.replace(/=\\r?\\n/g, '').replace(/=3D/gi, '=').replace(/=([A-Fa-f0-9]{2})/g, (_,h)=>String.fromCharCode(parseInt(h,16)))
          // Search code
          let m = decoded.match(/<b[^>]*>\s*(\d{6})\s*<\/b>/i) || decoded.match(/verification\s+code[:\s]+(\d{6})/i)
          if (m) { otp = m[1]; break }
        }
        resolve(otp)
      }
    })
    sock.on('error', () => { clearTimeout(to); resolve(null) })
  })
}

async function hasCaptcha(page) {
  return page.evaluate(() => {
    const doc = document
    const hasIframe = !!doc.querySelector('iframe[src*="challenges.cloudflare.com"]') || !!doc.querySelector('iframe[src*="turnstile"]') || !!doc.querySelector('iframe[src*="hcaptcha"]')
    const textual = (doc.body ? doc.body.innerText : '').toLowerCase().includes('verify you are human')
    return hasIframe || textual
  })
}

async function registerOne(email, pass, browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36' })
  const page = await ctx.newPage()
  try {
    console.log(`\n[1] Goto sign-in/create for ${email}`)
    await page.goto('https://play.cartesia.ai/sign-in/create', { waitUntil: 'domcontentloaded', timeout: 30000 })
    if (await hasCaptcha(page)) {
      console.log('⚠️ CAPTCHA detected on sign-in page, waiting 60s for manual solve (if headless:false you will see window)...')
      // wait up to 120s for captcha to disappear
      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(4000)
        if (!(await hasCaptcha(page))) { console.log('✅ Captcha gone'); break }
        console.log(` still captcha ${i+1}/30`)
      }
    }
    await page.waitForTimeout(2500)
    console.log('[2] Filling form')
    await page.evaluate(([fn, ln, em, pw]) => {
      function setVal(el, val) {
        if (!el) return
        const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
        if (desc && desc.set) desc.set.call(el, val); else el.value = val
        el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('blur', { bubbles: true }))
      }
      const inputs = Array.from(document.querySelectorAll('input')).filter(i => i.type !== 'hidden')
      setVal(inputs[0], fn); setVal(inputs[1], ln); setVal(inputs[2], em); setVal(inputs[3], pw)
    }, ['Alex', 'Cartel', email, pass])
    await page.waitForTimeout(500)
    console.log('[3] Click Continue')
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, input[type="submit"]'))
      const cont = btns.find(b => (b.textContent || '').trim().toLowerCase() === 'continue')
      if (cont) cont.click()
    })
    // Wait for verify page or OTP inputs
    console.log('[4] Wait verify page / OTP inputs (60s)')
    let reachedVerify = false
    let lastErr = null
    for (let t = 0; t < 60; t++) {
      if (await hasCaptcha(page)) { console.log(' captcha on verify wait'); await page.waitForTimeout(3000); continue }
      const err = await page.evaluate(() => {
        const url = location.href
        if (!url.includes('/sign-in/create')) return null
        const body = (document.body ? document.body.innerText : '').toLowerCase()
        if (body.includes('please enter a valid first name')) return 'Невірне first name'
        if (body.includes('please enter a valid last name')) return 'Невірне last name'
        if (body.includes('please enter a valid email')) return 'Невірний email'
        if (body.includes('password must')) return 'Слабкий пароль'
        if (body.includes('already exists')) return 'Акаунт уже існує'
        if (body.includes('captcha failed') || body.includes('verification failed')) return 'Captcha failed'
        return null
      })
      if (err) { lastErr = err; break }
      const st = await page.evaluate(() => {
        const url = location.href
        const inputs = Array.from(document.querySelectorAll('input'))
        const otpLike = inputs.filter(i => { const t=(i.type||'').toLowerCase(); if(t==='password'||t==='hidden') return false; const im=(i.getAttribute('inputmode')||'').toLowerCase(); const ac=(i.getAttribute('autocomplete')||'').toLowerCase(); return im==='numeric'||im==='tel'||ac==='one-time-code'||ac==='otp'||i.getAttribute('data-input-otp')==='true' })
        const visible = inputs.filter(i => (i.type||'').toLowerCase()!=='password' && (i.type||'').toLowerCase()!=='hidden')
        return { url, onVerify: url.includes('/verify-email-address')||url.includes('/sign-in/create/verify'), hasOtp: otpLike.length>0 || visible.length>=6 }
      })
      if (st.onVerify || st.hasOtp) { reachedVerify = true; console.log(` reached verify: url=${st.url} hasOtp=${st.hasOtp}`); break }
      await page.waitForTimeout(1000)
    }
    if (lastErr) { console.log(`❌ Validation error: ${lastErr}`); await ctx.close(); return { success: false, error: lastErr } }
    if (!reachedVerify) { console.log('❌ No verify page'); await ctx.close(); return { success: false, error: 'Не дочекались OTP' } }

    const startMs = Date.now()
    console.log('[5] Poll IMAP OTP (180s)')
    let otp = null
    for (let i = 1; i <= 35; i++) {
      otp = await fetchOtpForEmail(email, startMs)
      if (otp) { console.log(` ✅ OTP found: ${otp} on try ${i}`); break }
      process.stdout.write('.')
      await new Promise(r => setTimeout(r, 3000))
    }
    console.log()
    if (!otp) { console.log('❌ No OTP'); await ctx.close(); return { success: false, error: 'Лист не прийшов' } }

    console.log('[6] Fill OTP')
    try { await page.waitForSelector('input[data-input-otp="true"], input[autocomplete="one-time-code"]', { timeout: 20000 }) } catch { console.log('❌ OTP input timeout'); await ctx.close(); return { success: false, error: 'OTP input timeout' } }
    await page.evaluate((sel) => { const el=document.querySelector(sel); if(el) el.click() }, 'input[data-input-otp="true"], input[autocomplete="one-time-code"]')
    await page.waitForTimeout(200)
    await page.keyboard.type(otp, { delay: 80 })
    await page.waitForTimeout(200)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(4000)
    if (await hasCaptcha(page)) { console.log('captcha after OTP'); for(let i=0;i<15;i++){ await page.waitForTimeout(4000); if(!(await hasCaptcha(page))) break } }

    console.log('[7] Goto /keys')
    await page.goto('https://play.cartesia.ai/keys', { waitUntil: 'domcontentloaded', timeout: 30000 })
    if (await hasCaptcha(page)) { for(let i=0;i<15;i++){ await page.waitForTimeout(3000); if(!(await hasCaptcha(page))) break } }
    await page.waitForTimeout(3500)

    console.log('[8] Click Create API key')
    const createRes = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, a'))
      const btn = btns.find(b => (b.textContent||'').toLowerCase().includes('create api key'))
      if (btn) btn.click()
      return btn ? 'clicked' : 'not-found'
    })
    console.log(' createResult=', createRes)
    await page.waitForTimeout(2500)
    if (await hasCaptcha(page)) { for(let i=0;i<10;i++){ await page.waitForTimeout(3000); if(!(await hasCaptcha(page))) break } }
    await page.waitForTimeout(2000)

    // Fill description with 3 strategies
    console.log('[9] Fill description + submit')
    const descSel = 'input[name="description"], input[id="description"]'
    let found = false
    try { await page.waitForSelector(descSel, { timeout: 5000 }); found = true } catch { try { await page.waitForFunction(()=>{ const b=document.body?document.body.innerText.toLowerCase():''; return b.includes('api key') && document.querySelector('input')!==null }, { timeout: 5000}); found=true } catch {} }
    if (!found) console.log(' DESC not found')
    else {
      try { await page.click(descSel, { force: true }) } catch { await page.evaluate((s)=>{ const el=document.querySelector(s); if(el) el.click() }, descSel) }
      await page.waitForTimeout(300)
      try { await page.fill(descSel, 'Cartel Key') } catch { await page.evaluate(([s,v])=>{ const el=document.querySelector(s); if(!el) return; const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value'); if(d&&d.set) d.set.call(el,v); else el.value=v; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})) }, [descSel,'Cartel Key'])}
      await page.waitForTimeout(400)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(2000)
      let hasKey = await page.evaluate(()=> /sk_car_[A-Za-z0-9_-]{10,}/.test(document.body.innerText + document.documentElement.innerHTML.slice(0,10000)))
      if (!hasKey) {
        console.log(' try dialog button')
        const clicked = await page.evaluate(()=>{ const ds=Array.from(document.querySelectorAll('[role="dialog"], [data-radix-portal], .modal')); const scope=ds.length?ds[ds.length-1]:document; const btns=Array.from(scope.querySelectorAll('button')); const s=btns.find(b=>{const t=(b.textContent||'').trim().toLowerCase(); return t==='create'||t==='create api key'||t==='submit'||t==='save'||t==='confirm'}); if(s){s.click(); return true} return false })
        if (clicked) { await page.waitForTimeout(2000); hasKey = await page.evaluate(()=> /sk_car_[A-Za-z0-9_-]{10,}/.test(document.body.innerText + document.documentElement.innerHTML.slice(0,10000))) }
      }
      if (!hasKey) { console.log(' try form Enter'); await page.evaluate(()=>{ const f=document.querySelector('form'); if(f){ f.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}))}}); await page.keyboard.press('Enter'); await page.waitForTimeout(2000) }
    }

    console.log('[10] Poll sk_car_ (90s)')
    let keyFound = ''
    const pollStart = Date.now()
    while (Date.now() - pollStart < 90000) {
      const text = await page.evaluate(()=>{ const all=Array.from(document.querySelectorAll('input,textarea,code,pre,p,span,div,h1,h2,h3,button,strong')).map(e=>e.value||e.textContent||'').join('\n'); return all + '\n' + document.documentElement.innerHTML.slice(0,30000) })
      const m = text.match(/sk_car_[A-Za-z0-9_-]{16,}/)
      if (m) { keyFound = m[0]; console.log(` ✅ Found key: ${keyFound}`); break }
      if (Math.floor((Date.now()-pollStart)/1000)%5===0) process.stdout.write('.')
      await page.waitForTimeout(1500)
    }
    console.log()
    if (!keyFound) {
      // fallback broader
      const html = await page.evaluate(()=> document.documentElement.innerHTML.slice(0,60000))
      const body = await page.evaluate(()=> document.body?document.body.innerText:'')
      const fields = await page.evaluate(()=> Array.from(document.querySelectorAll('input,textarea,code,pre')).map(e=>e.value||e.textContent||'').join('\n'))
      const all = html+'\n'+body+'\n'+fields
      const mm = all.match(/sk_car_[A-Za-z0-9_-]{16,}/)
      if (mm) keyFound = mm[0]
    }
    await ctx.close()
    if (keyFound) return { success: true, key: keyFound }
    return { success: createRes==='clicked', error: createRes==='clicked' ? 'Ключ не знайдено — перевірте вручну' : 'Кнопку Create API key не знайдено' }
  } catch (e) {
    try { await ctx.close() } catch {}
    return { success: false, error: e.message || String(e) }
  }
}

async function main() {
  const count = 5
  const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled','--no-sandbox','--disable-dev-shm-usage'] })
  console.log(`🚀 Running ${count} registrations...`)
  const results = []
  for (let i = 0; i < count; i++) {
    const email = genEmail()
    const pass = genPass()
    console.log(`\n========== [${i+1}/${count}] ${email} / ${pass} ==========`)
    const res = await registerOne(email, pass, browser)
    console.log(` RESULT ${i+1}: success=${res.success} key=${res.key||'none'} error=${res.error||'none'}`)
    results.push({ email, pass, ...res })
    const line = `${new Date().toISOString().slice(0,19).replace('T',' ')} | Email: ${email} | Pass: ${pass} | Key: ${res.key||'no-key'} | ${res.error||'ok'}\n`
    try { appendFileSync(join(DATA_DIR,'accounts.txt'), line, 'utf8') } catch {}
    try { appendFileSync(join('dist/output','accounts.txt'), line, 'utf8') } catch {}
    if (res.key) {
      // also push to keys.json
      const kp = join(DATA_DIR,'keys.json')
      let keys=[]; if(existsSync(kp)) try{ keys=JSON.parse(readFileSync(kp,'utf8')) }catch{}
      keys.push({ id: `key_${Date.now()}_${i}`, key: res.key, label: `Auto-Reg (${email})`, usedChars:0, limit:20000, status:'active', role:'pool', createdAt: new Date().toISOString() })
      writeFileSync(kp, JSON.stringify(keys,null,2),'utf8')
      console.log(' 🎉 Key added to keys.json')
      totalOk++
    } else totalFail++
    if (i < count-1) { const pause = 3000+Math.floor(Math.random()*2000); console.log(` pause ${pause}ms`); await new Promise(r=>setTimeout(r,pause)) }
  }
  await browser.close()
  console.log(`\n========== DONE ${totalOk} ok / ${totalFail} fail ==========`)
  for (const r of results) console.log(`${r.email} -> ${r.key||r.error}`)
}

main().catch(e=>{ console.error(e); process.exit(1) })
