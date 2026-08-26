import { chromium } from 'playwright'
import tls from 'tls'
import { readFileSync, appendFileSync, writeFileSync, existsSync } from 'fs'

const settings = JSON.parse(readFileSync('dist/data/settings.json', 'utf8'))

async function fetchOtpCode(targetEmail, sinceMs = Date.now() - 3 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({
      host: settings.imapConfig.host || 'imap.gmail.com',
      port: settings.imapConfig.port || 993,
      rejectUnauthorized: false
    })

    let buffer = ''
    let stage = 'CONNECT'
    let otpCode = null

    sock.setEncoding('utf8')

    const timeout = setTimeout(() => {
      sock.destroy()
      resolve(null)
    }, 15000)

    sock.on('data', (chunk) => {
      buffer += chunk

      if (stage === 'CONNECT' && buffer.includes('* OK')) {
        stage = 'LOGIN'
        buffer = ''
        sock.write(`A1 LOGIN "${settings.imapConfig.user}" "${settings.imapConfig.pass}"\r\n`)
      } else if (stage === 'LOGIN' && buffer.includes('A1 OK')) {
        stage = 'SELECT'
        buffer = ''
        sock.write(`A2 SELECT INBOX\r\n`)
      } else if (stage === 'SELECT' && buffer.includes('A2 OK')) {
        stage = 'SEARCH'
        buffer = ''
        sock.write(`A3 UID SEARCH SINCE 01-Jan-2026 FROM "cartesia.ai"\r\n`)
      } else if (stage === 'SEARCH' && buffer.includes('A3 OK')) {
        const match = buffer.match(/\* SEARCH\s+([\d\s]+)/)
        const uids = match ? match[1].trim().split(/\s+/).filter(Boolean) : []
        if (!uids.length) {
          clearTimeout(timeout)
          sock.end()
          resolve(null)
          return
        }
        stage = 'FETCH'
        buffer = ''
        const lastUid = uids[uids.length - 1]
        sock.write(`A4 UID FETCH ${lastUid} (BODY[TEXT] BODY[HEADER.FIELDS (SUBJECT TO FROM)])\r\n`)
      } else if (stage === 'FETCH' && buffer.includes('A4 OK')) {
        clearTimeout(timeout)
        sock.end()

        const decoded = buffer
          .replace(/=\r?\n/g, '')
          .replace(/=([A-Fa-f0-9]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))

        const codeMatch =
          decoded.match(/<b[^>]*>\s*(\d{6})\s*<\/b>/i) ||
          decoded.match(/verification\s+code[:\s]+(\d{6})/i) ||
          decoded.match(/\b(\d{6})\b/)

        if (codeMatch) {
          otpCode = codeMatch[1]
        }
        resolve(otpCode)
      }
    })

    sock.on('error', (err) => {
      clearTimeout(timeout)
      resolve(null)
    })
  })
}

async function testKeyboardTypeOtp() {
  const rnd = Math.random().toString(36).slice(2, 8)
  const email = `cartelia_${rnd}@${settings.catchAllDomain}`
  const password = `Cartelia_${rnd.toUpperCase()}!9`

  console.log(`\n========================================`)
  console.log(`Creating Account: ${email}`)
  console.log(`Password: ${password}`)
  console.log(`========================================\n`)

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  })

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
  })

  const page = await context.newPage()

  try {
    console.log('[1] Opening registration page...')
    await page.goto('https://play.cartesia.ai/sign-in/create', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)

    console.log('[2] Filling registration form...')
    await page.evaluate(
      ([fn, ln, em, pw]) => {
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
        const first = inputs.find((i) => i.name === 'firstName' || i.placeholder.toLowerCase().includes('first'))
        const last = inputs.find((i) => i.name === 'lastName' || i.placeholder.toLowerCase().includes('last'))
        const emailEl = inputs.find((i) => i.type === 'email' || i.name === 'emailAddress' || i.name === 'email')
        const passEl = inputs.find((i) => i.type === 'password' || i.name === 'password')

        if (first) setVal(first, fn)
        if (last) setVal(last, ln)
        if (emailEl) setVal(emailEl, em)
        if (passEl) setVal(passEl, pw)
      },
      ['Alex', 'Cartel', email, password]
    )

    await page.waitForTimeout(1000)

    console.log('[3] Submitting registration form...')
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, input[type="submit"]'))
      const cont = btns.find((b) => (b.textContent || '').trim().toLowerCase() === 'continue')
      if (cont) cont.click()
    })

    await page.waitForTimeout(3000)

    console.log('[4] Fetching OTP from IMAP...')
    const startMs = Date.now()
    let otp = null
    for (let attempt = 1; attempt <= 20; attempt++) {
      otp = await fetchOtpCode(email, startMs)
      if (otp) break
      await new Promise((r) => setTimeout(r, 3000))
    }

    if (!otp) {
      console.error('❌ OTP not received')
      await browser.close()
      return
    }

    console.log(`[5] Focusing OTP input and native keyboard typing: "${otp}" ...`)
    await page.waitForSelector('input', { state: 'attached', timeout: 10000 })
    await page.click('input')
    await page.waitForTimeout(300)
    await page.keyboard.type(otp, { delay: 100 })
    await page.waitForTimeout(500)

    console.log('[5a] Clicking Continue button after typing OTP ...')
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, input[type="submit"]'))
      const cont = btns.find((b) => (b.textContent || '').trim().toLowerCase() === 'continue')
      if (cont) cont.click()
    })

    // Watch URL transitions for 8 seconds
    for (let sec = 1; sec <= 8; sec++) {
      await page.waitForTimeout(1000)
      console.log(`[After OTP submit +${sec}s] URL:`, page.url())
    }

    console.log('[6] Navigating to https://play.cartesia.ai/keys ...')
    await page.goto('https://play.cartesia.ai/keys', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3500)

    console.log('[7] Dashboard URL:', page.url())

    // Click Create API Key
    console.log('[8] Clicking Create API Key ...')
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, a'))
      const btn = btns.find((b) => {
        const t = (b.textContent || '').trim().toLowerCase()
        return t.includes('create api key') || t.includes('create key') || t.includes('new key') || t.includes('create')
      })
      if (btn) btn.click()
    })

    await page.waitForTimeout(2000)

    // Fill Modal Name if present
    await page.evaluate(() => {
      const input = document.querySelector('input[placeholder*="name" i], input[type="text"]')
      if (input) {
        const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
        if (desc?.set) desc.set.call(input, 'AutoKey')
        else input.value = 'AutoKey'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }
      const btns = Array.from(document.querySelectorAll('button'))
      const submitBtn = btns.find((b) => {
        const t = (b.textContent || '').trim().toLowerCase()
        return t === 'create' || t.includes('create') || t.includes('generate') || t.includes('save')
      })
      if (submitBtn) submitBtn.click()
    })

    await page.waitForTimeout(3000)

    // Extract key sk_car_...
    const bodyText = await page.evaluate(() => document.body ? document.body.innerText : '')
    const fieldTexts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input,textarea,code,pre'))
        .map((e) => e.value || e.textContent || '')
        .join('\n')
    )

    const fullText = `${bodyText}\n${fieldTexts}`
    const keys = fullText.match(/sk_car_[A-Za-z0-9_-]{16,}/g) ?? []

    const extractedKey = keys[0] || 'no-key-extracted'
    console.log(`\n========================================`)
    console.log(`FINAL RESULT:`)
    console.log(`Email: ${email}`)
    console.log(`Password: ${password}`)
    console.log(`API Key: ${extractedKey}`)
    console.log(`========================================\n`)

    // Save account
    const accountLine = `${new Date().toISOString()} | Email: ${email} | Pass: ${password} | Key: ${extractedKey}\n`
    appendFileSync('dist/data/accounts.txt', accountLine, 'utf8')

    if (extractedKey !== 'no-key-extracted') {
      const keysPath = 'dist/data/keys.json'
      let currentKeys = []
      if (existsSync(keysPath)) {
        try {
          currentKeys = JSON.parse(readFileSync(keysPath, 'utf8'))
        } catch (_) {}
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
      console.log('✅ Key saved to dist/data/keys.json !')
    }

    await browser.close()
  } catch (err) {
    console.error('❌ Error during run:', err)
    await browser.close()
  }
}

await testKeyboardTypeOtp()
