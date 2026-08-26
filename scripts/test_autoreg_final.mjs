import { chromium } from 'playwright'
import tls from 'tls'
import { readFileSync, appendFileSync, writeFileSync, existsSync } from 'fs'

const settings = JSON.parse(readFileSync('dist/data/settings.json', 'utf8'))

async function fetchOtpCodeForEmail(targetEmail, startTime) {
  return new Promise((resolve) => {
    const sock = tls.connect({
      host: settings.imapConfig.host || 'imap.gmail.com',
      port: settings.imapConfig.port || 993,
      rejectUnauthorized: false
    })
    let buffer = ''
    let stage = 'CONNECT'
    let otpCode = null
    sock.setEncoding('utf8')
    const timeout = setTimeout(() => { sock.destroy(); resolve(null) }, 15000)
    sock.on('data', (chunk) => {
      buffer += chunk
      if (stage === 'CONNECT' && buffer.includes('* OK')) { stage = 'LOGIN'; buffer = ''; sock.write(`A1 LOGIN "${settings.imapConfig.user}" "${settings.imapConfig.pass}"\r\n`) }
      else if (stage === 'LOGIN' && buffer.includes('A1 OK')) { stage = 'SELECT'; buffer = ''; sock.write(`A2 SELECT INBOX\r\n`) }
      else if (stage === 'SELECT' && buffer.includes('A2 OK')) { stage = 'SEARCH'; buffer = ''
        const since = new Date(startTime - 60000)
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        const dateStr = `${String(since.getDate()).padStart(2, '0')}-${months[since.getMonth()]}-${since.getFullYear()}`
        sock.write(`A3 UID SEARCH SINCE ${dateStr} FROM "cartesia.ai"\r\n`)
      }
      else if (stage === 'SEARCH' && buffer.includes('A3 OK')) {
        const match = buffer.match(/\* SEARCH\s+([\d\s]+)/)
        const uids = match ? match[1].trim().split(/\s+/).filter(Boolean) : []
        if (!uids.length) { clearTimeout(timeout); sock.end(); resolve(null); return }
        stage = 'FETCH_RECENT'; buffer = ''
        sock.write(`A4 UID FETCH ${uids.slice(-10).join(',')} (BODY[TEXT] BODY[HEADER.FIELDS (SUBJECT TO FROM DATE)])\r\n`)
      }
      else if (stage === 'FETCH_RECENT' && buffer.includes('A4 OK')) {
        clearTimeout(timeout); sock.end()
        const messages = buffer.split(/\* \d+ FETCH/i)
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i]
          if (!msg) continue
          const decoded = msg.replace(/=\r?\n/g, '').replace(/=([A-Fa-f0-9]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
          if (decoded.toLowerCase().includes(targetEmail.toLowerCase())) {
            const codeMatch = decoded.match(/<b[^>]*>\s*(\d{6})\s*<\/b>/i) || decoded.match(/verification\s+code[:\s]+(\d{6})/i) || decoded.match(/\b(\d{6})\b/)
            if (codeMatch) { otpCode = codeMatch[1]; break }
          }
        }
        resolve(otpCode)
      }
    })
    sock.on('error', () => { clearTimeout(timeout); resolve(null) })
  })
}

async function run() {
  const rnd = Math.random().toString(36).slice(2, 8)
  const email = `cartelia_${rnd}@${settings.catchAllDomain}`
  const password = `Cartelia_${rnd.toUpperCase()}!9`

  console.log(`\n🎯 Creating: ${email} / ${password}\n`)

  const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'] })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()

  try {
    await page.goto('https://play.cartesia.ai/sign-in/create', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)

    await page.evaluate(([fn, ln, em, pw]) => {
      function setVal(el, val) {
        if (!el) return
        const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
        if (desc?.set) desc.set.call(el, val)
        else el.value = val
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        el.dispatchEvent(new Event('blur', { bubbles: true }))
      }
      const inputs = Array.from(document.querySelectorAll('input'))
      setVal(inputs[0], fn)
      setVal(inputs[1], ln)
      setVal(inputs[2], em)
      setVal(inputs[3], pw)
    }, ['Alex', 'Cartel', email, password])

    await page.waitForTimeout(500)
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, input[type="submit"]'))
      const cont = btns.find((b) => (b.textContent || '').trim().toLowerCase() === 'continue')
      if (cont) cont.click()
    })

    const startMs = Date.now()
    let otp = null
    for (let i = 1; i <= 25; i++) {
      otp = await fetchOtpCodeForEmail(email, startMs)
      if (otp) break
      await new Promise((r) => setTimeout(r, 3000))
    }
    if (!otp) { console.error('❌ No OTP'); await browser.close(); return }

    await page.waitForTimeout(2000)
    await page.click('input[data-input-otp="true"], input[autocomplete="one-time-code"]')
    await page.waitForTimeout(300)
    await page.keyboard.type(otp, { delay: 100 })
    await page.waitForTimeout(300)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(5000)

    await page.goto('https://play.cartesia.ai/keys', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3500)

    // Open modal
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, a'))
      const btn = btns.find((b) => (b.textContent || '').toLowerCase().includes('create api key'))
      if (btn) btn.click()
    })
    await page.waitForTimeout(2500)

    // ===== FILL DESCRIPTION + PRESS ENTER (найнадійніший спосіб!) =====
    await page.click('input[name="description"], input[id="description"]')
    await page.waitForTimeout(300)
    await page.keyboard.type('Cartel Key', { delay: 80 })
    await page.waitForTimeout(300)
    await page.keyboard.press('Enter')

    // Polling sk_car_...
    let extractedKey = null
    const pollStart = Date.now()
    console.log('[8] Polling for sk_car_ key (up to 60s, after Enter)...')

    while (Date.now() - pollStart < 60000) {
      const text = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('input,textarea,code,pre,p,span,div,h1,h2,h3,button,strong'))
          .map((e) => e.value || e.textContent || '')
          .join('\n')
        return all
      })
      const match = text.match(/sk_car_[A-Za-z0-9_-]{16,}/)
      if (match) {
        extractedKey = match[0]
        console.log(`  ✅ Found key on attempt ${Math.floor((Date.now() - pollStart) / 1000)}s: ${extractedKey}`)
        break
      }
      const elapsed = Math.floor((Date.now() - pollStart) / 1000)
      if (elapsed % 5 === 0) console.log(`  ...still waiting (${elapsed}s)`)
      await page.waitForTimeout(1500)
    }

    const accountLine = `${new Date().toISOString()} | Email: ${email} | Pass: ${password} | Key: ${extractedKey || 'no-key'}\n`
    try { appendFileSync('dist/data/accounts.txt', accountLine, 'utf8') } catch (_) {}
    try { appendFileSync('dist/output/accounts.txt', accountLine, 'utf8') } catch (_) {}

    if (extractedKey && extractedKey.startsWith('sk_car_')) {
      const keysPath = 'dist/data/keys.json'
      let currentKeys = []
      if (existsSync(keysPath)) {
        try { currentKeys = JSON.parse(readFileSync(keysPath, 'utf8')) } catch (_) {}
      }
      currentKeys.push({
        id: `key_${Date.now()}`,
        key: extractedKey,
        label: `Auto-Reg (${email})`,
        usedChars: 0,
        limit: 20000,
        status: 'active',
        role: 'pool',
        createdAt: new Date().toISOString()
      })
      writeFileSync(keysPath, JSON.stringify(currentKeys, null, 2), 'utf8')
      console.log('🎉 KEY ADDED to keys.json !')
    }

    console.log(`\n========================================`)
    console.log(`🎯 RESULT:`)
    console.log(`Email: ${email}`)
    console.log(`Password: ${password}`)
    console.log(`API Key: ${extractedKey || 'NOT FOUND'}`)
    console.log(`========================================\n`)
  } catch (err) {
    console.error('❌ Помилка:', err)
  } finally {
    await browser.close()
  }
}

await run()
