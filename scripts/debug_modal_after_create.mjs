import { chromium } from 'playwright'
import tls from 'tls'
import { readFileSync } from 'fs'

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
      else if (stage === 'SELECT' && buffer.includes('A2 OK')) {
        stage = 'SEARCH'
        buffer = ''
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

const rnd = Math.random().toString(36).slice(2, 8)
const email = `cartelia_${rnd}@${settings.catchAllDomain}`
const password = `Cartelia_${rnd.toUpperCase()}!9`

console.log('\n--- DEBUG: inspecting page state right after Create modal submit ---')

const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await context.newPage()

await page.goto('https://play.cartesia.ai/sign-in/create', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)

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
    setVal(inputs[0], fn)
    setVal(inputs[1], ln)
    setVal(inputs[2], em)
    setVal(inputs[3], pw)
  },
  ['Alex', 'Cartel', email, password]
)

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
if (!otp) { console.error('❌ No OTP'); await browser.close(); process.exit(1) }

await page.waitForTimeout(2000)
await page.click('input[data-input-otp="true"], input[autocomplete="one-time-code"]')
await page.waitForTimeout(300)
await page.keyboard.type(otp, { delay: 100 })
await page.waitForTimeout(300)
await page.keyboard.press('Enter')
await page.waitForTimeout(5000)

await page.goto('https://play.cartesia.ai/keys', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)

await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button, a'))
  const btn = btns.find((b) => (b.textContent || '').toLowerCase().includes('create api key'))
  if (btn) btn.click()
})
await page.waitForTimeout(2000)

await page.evaluate(() => {
  const input = document.querySelector('input[name="description"], input[id="description"]')
  if (input) {
    const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
    if (desc?.set) desc.set.call(input, 'Cartel Key')
    else input.value = 'Cartel Key'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    input.dispatchEvent(new Event('blur', { bubbles: true }))
  }
  const btns = Array.from(document.querySelectorAll('button[type="submit"], button'))
  const submitBtn = btns.find((b) => {
    const t = (b.textContent || '').trim().toLowerCase()
    return t === 'create' || t === 'generate' || t.includes('create api key')
  })
  if (submitBtn) submitBtn.click()
})

// Track page DOM changes every 2s for 30s
console.log('\n--- Tracking DOM changes after Create submit ---')
for (let sec = 1; sec <= 15; sec++) {
  await page.waitForTimeout(2000)

  const state = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input')).map((i) => ({
      name: i.name, id: i.id, type: i.type, value: (i.value || '').slice(0, 60), placeholder: i.placeholder
    }))
    const buttons = Array.from(document.querySelectorAll('button')).map((b) => (b.textContent || '').trim().slice(0, 30))
    const allVisibleText = document.body ? document.body.innerText : ''
    const hasSkCar = /sk_car_[A-Za-z0-9_-]{16,}/.test(allVisibleText) || inputs.some((i) => /sk_car_/.test(i.value))
    return { url: location.href, inputs, buttons, hasSkCar, textSnippet: allVisibleText.slice(0, 800) }
  })

  console.log(`\n[After ${sec * 2}s] ${state.hasSkCar ? '✅ KEY' : '❌'}`)
  console.log(`URL: ${state.url}`)
  console.log(`Buttons: ${state.buttons.join(' | ')}`)
  console.log(`Inputs: ${JSON.stringify(state.inputs)}`)
  console.log(`Text snippet: ${state.textSnippet.slice(0, 400)}`)

  if (state.hasSkCar) break
}

await browser.close()
