// Запуск: node scripts/probe_register.mjs <email> <password> [imapUser] [imapPass] [imapHost] [imapPort]
// Приклад:
//   node scripts/probe_register.mjs cartelia_test@kaleny.uk Cartelia_AB!9 nameofsewar@gmail.com "app-password" imap.gmail.com 993
//
// Скрипт повністю імітує PlaywrightRegistrar.registerOne: відкриває sign-in/create,
// заповнює форму, клікає Continue, очікує лист через IMAP, переходить за лінком,
// логіниться якщо WorkOS редіректить, тисне Create API key, друкує ключ.

import { chromium } from 'playwright'
import tls from 'tls'

const [, , email, password, imapUser, imapPass, imapHost = 'imap.gmail.com', imapPort = '993'] =
  process.argv
if (!email || !password) {
  console.error('Usage: node scripts/probe_register.mjs <email> <password> [imapUser] [imapPass] [imapHost] [imapPort]')
  process.exit(1)
}

function logStep(s) {
  console.log(`\n=== ${s} ===`)
}
function logError(s) {
  console.log(`!!! ${s}`)
}

function setVal(el, val) {
  const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
  if (desc?.set) desc.set.call(el, val)
  else el.value = val
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  el.dispatchEvent(new Event('blur', { bubbles: true }))
}

async function findVerificationLink(imapConfig, recipientEmail, sinceMs = Date.now() - 60_000) {
  return new Promise((resolve) => {
    const sock = tls.connect({ host: imapConfig.host, port: +imapConfig.port || 993, rejectUnauthorized: false })
    let buffer = ''
    let stage = 'greet'
    let totalMsgs = 0

    const send = (cmd) => {
      sock.write(`${cmd}\r\n`)
    }

    const tagResponse = (tag, data) => {
      const lines = data.split('\r\n')
      const last = lines.find((l) => l.startsWith(`${tag} `))
      return last
    }

    sock.setEncoding('utf8')
    sock.on('data', (data) => {
      buffer += data
      if (stage === 'greet' && buffer.includes('* OK')) {
        stage = 'login'
        send(`A1 LOGIN "${imapConfig.user}" "${imapConfig.pass}"`)
      } else if (stage === 'login' && buffer.includes('A1 OK')) {
        stage = 'select'
        send('A2 SELECT INBOX')
        buffer = ''
      } else if (stage === 'select' && buffer.includes('A2 OK')) {
        stage = 'status'
        send('A3 STATUS INBOX (MESSAGES)')
        buffer = ''
      } else if (stage === 'status') {
        const m = buffer.match(/MESSAGES\s+(\d+)/i)
        if (m) totalMsgs = +m[1]
        stage = 'fetch'
        buffer = ''
        const start = Math.max(1, totalMsgs - 10)
        if (totalMsgs > 0) send(`A4 FETCH ${start}:${totalMsgs} BODY[TEXT]`)
        else {
          sock.end()
          resolve({ found: false })
        }
      } else if (stage === 'fetch') {
        const full = buffer
        // шукаємо листа з recipientEmail
        const lowerEmail = recipientEmail.toLowerCase()
        const has = full.toLowerCase().includes(lowerEmail)
        if (has) {
          const urlMatch = full.match(/https?:\/\/[^\s"'>]+/gi) || []
          const clean = urlMatch
            .map((u) => u.replace(/=3D/gi, '=').replace(/&amp;/gi, '&').replace(/\r?\n/g, '').trim())
            .find((u) =>
              u.includes('cartesia') || u.includes('verify') || u.includes('confirm') || u.includes('callback')
            )
          if (clean) {
            sock.end()
            resolve({ found: true, link: clean })
            return
          }
        }
        if (buffer.includes('A4 OK')) {
          sock.end()
          resolve({ found: false })
        }
      }
    })

    sock.on('error', (err) => {
      logError(`IMAP помилка: ${err.message}`)
      resolve({ found: false, error: err.message })
    })

    sock.setTimeout(20000, () => {
      sock.destroy()
      resolve({ found: false, error: 'IMAP timeout' })
    })
  })
}

const imapConfig = imapUser && imapPass ? { user: imapUser, pass: imapPass, host: imapHost, port: imapPort } : null

const browser = await chromium.launch({
  headless: false,
  args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
})
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
})
const page = await ctx.newPage()

try {
  logStep(`1. Відкриваємо https://play.cartesia.ai/sign-in/create`)
  await page.goto('https://play.cartesia.ai/sign-in/create', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)

  logStep(`2. Заповнюємо 4 поля`)
  await page.evaluate(
    ([fn, ln, em, pw]) => {
      function setVal(el, val) {
        const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
        if (desc?.set) desc.set.call(el, val)
        else el.value = val
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }
      const first = document.querySelector('input[name="firstName"]')
      const last = document.querySelector('input[name="lastName"]')
      const emailEl = document.querySelector('input[name="emailAddress"]')
      const passEl = document.querySelector('input[name="password"]')
      if (first) setVal(first, fn)
      if (last) setVal(last, ln)
      if (emailEl) setVal(emailEl, em)
      if (passEl) setVal(passEl, pw)
    },
    ['Alex', 'Cartel', email, password]
  )

  logStep(`3. Клікаємо Continue (точний текст)`)
  const submitResult = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, input[type="submit"]'))
    const cont = btns.find((b) => (b.textContent || '').trim().toLowerCase() === 'continue')
    if (cont) {
      cont.click()
      return 'clicked'
    }
    return 'not-found'
  })
  console.log(`Continue click: ${submitResult}`)

  logStep(`4. Очікуємо появу помилки валідації / зміну URL`)
  let validationError = null
  const startWait = Date.now()
  while (Date.now() - startWait < 60_000) {
    const err = await page.evaluate(() => {
      const body = document.body ? document.body.innerText.toLowerCase() : ''
      if (body.includes('please enter a valid first name')) return 'Невірне first name'
      if (body.includes('please enter a valid last name')) return 'Невірне last name'
      if (body.includes('please enter a valid email')) return 'Невірний email'
      if (body.includes('password must')) return 'Слабкий пароль'
      if (body.includes('already exists')) return 'Акаунт вже існує'
      if (body.includes('captcha failed')) return 'Captcha failed'
      return null
    })
    if (err) {
      validationError = err
      break
    }
    if (!page.url().includes('/sign-in/create')) break
    await page.waitForTimeout(1000)
  }

  if (validationError) {
    logError(`Валідація: ${validationError}`)
    console.log('Поточний URL:', page.url())
    await browser.close()
    process.exit(1)
  }

  logStep(`5. Очікуємо лист від Cartesia через IMAP (${imapConfig ? 'увімкнено' : 'ВИМКНЕНО — передайте imapUser/imapPass'})`)
  if (!imapConfig) {
    logError('Не задано IMAP. Неможливо перевірити лист. Відкрийте вручну лист верифікації та натисніть Enter тут.')
    await new Promise((r) => process.stdin.once('data', r))
  }
  const startedAt = Date.now()
  let link = null
  while (Date.now() - startedAt < 180_000) {
    if (imapConfig) {
      const res = await findVerificationLink(imapConfig, email)
      if (res.found && res.link) {
        link = res.link
        break
      }
    }
    process.stdout.write('.')
    await new Promise((r) => setTimeout(r, 3000))
  }
  console.log()
  if (!link) {
    logError('Лист верифікації не прийшов')
    await browser.close()
    process.exit(1)
  }
  logStep(`6. Знайдено лінк: ${link}`)

  logStep(`7. Переходимо за лінком листа`)
  await page.goto(link, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)

  if (page.url().includes('/sign-in') && page.url().includes('redirect_url')) {
    logStep(`7a. WorkOS редіректнув на логін — логінимось`)
    await page.evaluate((em) => {
      const inp = document.querySelector('input[name="identifier"]')
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      if (inp) {
        if (desc?.set) desc.set.call(inp, em)
        else inp.value = em
        inp.dispatchEvent(new Event('input', { bubbles: true }))
        inp.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }, email)
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(
        (b) => (b.textContent || '').trim().toLowerCase() === 'continue'
      )
      if (btn) btn.click()
    })
    await page.waitForTimeout(2000)
    await page.evaluate((pw) => {
      const inp = document.querySelector('input[name="password"]')
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      if (inp) {
        if (desc?.set) desc.set.call(inp, pw)
        else inp.value = pw
        inp.dispatchEvent(new Event('input', { bubbles: true }))
        inp.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }, password)
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(
        (b) => (b.textContent || '').trim().toLowerCase() === 'continue'
      )
      if (btn) btn.click()
    })
    await page.waitForTimeout(3000)
  }

  logStep(`8. Йдемо на https://play.cartesia.ai/keys`)
  await page.goto('https://play.cartesia.ai/keys', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)

  logStep(`9. Шукаємо кнопку "Create API key"`)
  const createClicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, a'))
    const create = btns.find((b) => {
      const t = (b.textContent || '').trim().toLowerCase()
      return t === 'create api key' || t.startsWith('create api key')
    })
    if (create) {
      create.click()
      return 'clicked'
    }
    return 'not-found'
  })
  console.log(`Create API key: ${createClicked}`)

  await page.waitForTimeout(3000)

  logStep(`10. Шукаємо ключ sk_car_ на сторінці`)
  const bodyText = await page.evaluate(() => document.body ? document.body.innerText : '')
  const inputs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input,textarea,code,pre'))
      .map((e) => e.value || e.textContent || '')
      .join('\n')
  )
  const all = `${bodyText}\n${inputs}`
  const match = all.match(/sk_car_[A-Za-z0-9_-]{16,}/g)
  if (match && match.length) {
    console.log(`\n✅ ЗНАЙДЕНО КЛЮЧ: ${match[0]}`)
  } else {
    logError('Ключ sk_car_ не знайдено на сторінці')
    console.log('--- перші 1500 символів тексту сторінки ---')
    console.log(bodyText.slice(0, 1500))
  }
} catch (err) {
  logError(`Виняток: ${err.message}`)
  console.error(err)
} finally {
  await browser.close()
}