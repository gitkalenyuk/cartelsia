import tls from 'tls'
const BASE = 'https://clerk.cartesia.ai'
const QS = '__clerk_api_version=2026-05-12&_clerk_js_version=6.30.1'
const H = { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36', Origin: 'https://play.cartesia.ai', Referer: 'https://play.cartesia.ai/sign-in/create' }
const form = (o) => new URLSearchParams(o).toString()
const t = Date.now().toString(36)
const email = 'furiatest_' + t + '@furia.ink'
console.log('EMAIL=', email)

const res1 = await fetch(BASE + '/v1/client/sign_ups?' + QS, { method: 'POST', headers: H, body: form({ email_address: email, first_name: 'Alex', last_name: 'Cartel', password: 'Furia_' + t.slice(-3).toUpperCase() + 'ab1!9', locale: 'en-US' }) })
const b1 = await res1.json()
const suaId = b1.response?.id || b1.data?.id || b1.meta?.client?.sign_up?.id
console.log('1) sign_ups=' + res1.status, 'sua=' + suaId, 'status=', b1.data?.status, 'errors=', JSON.stringify(b1.errors || null))
if (!suaId) { console.log(JSON.stringify(b1).slice(0, 400)); process.exit(1) }

const ck1 = res1.headers.getSetCookie ? res1.headers.getSetCookie() : []
const ck1s = ck1.map(c => c.split(';')[0]).join('; ')
console.log('   cookies from sign_ups:', ck1.map(c => c.split('=')[0]).join(', '))
const H2 = { ...H, Cookie: ck1s }
const res2 = await fetch(BASE + '/v1/client/sign_ups/' + suaId + '/prepare_verification?' + QS, { method: 'POST', headers: H2, body: form({ strategy: 'email_code' }) })
const b2 = await res2.text()
const b2j = res2.status === 200 ? JSON.parse(b2) : null
console.log('2) prepare_verification=' + res2.status, 'requirements=', JSON.stringify(b2j?.data?.status_requirements || b2j?.data?.status || b2.slice(0, 120)))

// ---- IMAP ----
function connect() {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host: 'imap.gmail.com', port: 993, rejectUnauthorized: false })
    sock.setEncoding('utf8')
    let lineBuf = '', active = null, greeted = false, seq = 0
    sock.on('data', (d) => {
      lineBuf += d
      let idx
      while ((idx = lineBuf.indexOf('\r\n')) >= 0) {
        const line = lineBuf.slice(0, idx); lineBuf = lineBuf.slice(idx + 2)
        if (!greeted && line.startsWith('* OK')) { greeted = true; resolve({ sock, cmd }); continue }
        const m = line.match(/^(A\d+) (OK|NO|BAD)(?: \[([^\]]*)\])?\s?(.*)$/)
        if (active && m && m[1] === active.tag) { const a = active; active = null; a.res((a.data ? a.data + '\r\n' : '') + line) }
        else if (active) active.data += line + '\r\n'
      }
    })
    sock.on('error', reject)
    setTimeout(() => { if (!greeted) reject(new Error('greet timeout')) }, 10000)
    function cmd(c) {
      return new Promise((res, rej) => {
        const tag = 'A' + (++seq)
        active = { tag, data: '', res }
        sock.write(tag + ' ' + c + '\r\n')
        setTimeout(() => { if (active && active.tag === tag) { active = null; rej(new Error('timeout ' + c)) } }, 30000)
      })
    }
  })
}
let imapOk = false
try {
  const s = await connect()
  const lo = await s.cmd('LOGIN "nameofsewar@gmail.com" "bvhm syil lcsd bgnu"')
  console.log('3) LOGIN =>', lo.trim().slice(0, 100))
  if (!/\bOK\b/.test(lo)) throw new Error('login rejected: ' + lo.trim().slice(0, 100))
  imapOk = true
  await s.cmd('SELECT INBOX')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; const n = new Date()
  const d = String(n.getDate()).padStart(2, '0') + '-' + months[n.getMonth()] + '-' + n.getFullYear()
  const t0 = Date.now()
  let code = null
  while (Date.now() - t0 < 150000 && !code) {
    const so = await s.cmd('UID SEARCH SINCE ' + d)
    const uids = (so.match(/SEARCH\s+([\d\s]+)/)?.[1] || '').trim().split(/\s+/).filter(Boolean)
    for (const uid of uids.slice(-6).reverse()) {
      const f = await s.cmd('UID FETCH ' + uid + ' (BODY.PEEK[HEADER.FIELDS (TO SUBJECT DATE)] BODY.PEEK[TEXT])')
      if (!/furia\.ink|cartesia/i.test(f)) continue
      const dec = f.replace(/=3D/g, '=').replace(/[0-9a-fA-F]{2}=/g, (m) => { const c = parseInt(m.slice(0, 2), 16); return (c >= 32 && c < 127) ? String.fromCharCode(c) : '?' })
      const to = (dec.match(/To[:(]\s*([^\r\n]+)/i) || [''])[0]
      const digits = (dec.replace(/<[^>]+>/g, ' ').match(/>\s*(\d{6})\s*</) || dec.match(/code[\s:]{0,4}(\d{6})/i) || dec.match(/\b(\d{6})\b/g))
      console.log('   mail uid=' + uid, 'to=' + to.slice(0, 50), 'code candidates=', Array.isArray(digits) ? digits.slice(0, 4).join(',') : digits?.[1] || null)
      if (digits && to.includes(email)) code = digits[1] || (Array.isArray(digits) ? digits[0] : null)
    }
    if (!code) { console.log('   polling ' + Math.round((Date.now() - t0) / 1000) + 's ...'); await new Promise((r) => setTimeout(r, 8000)) }
  }
  s.cmd('LOGOUT').catch(() => {}); s.sock.end()
  if (code) {
    const res4 = await fetch(BASE + '/v1/client/sign_ups/' + suaId + '/attempt_verification?' + QS, { method: 'POST', headers: H2, body: form({ verification_code: code, strategy: 'email_code' }) })
    const b4t = await res4.text()
    console.log('5) attempt_verification=' + res4.status, b4t.slice(0, 300))
    console.log('FINAL_EMAIL', email)
  } else {
    console.log('NO_CODE_TIMEOUT (пошта не надійшла або IMAP не бачить її)')
  }
} catch (e) {
  console.log('IMAP BLOCKED:', e.message)
  console.log('Використовувач може перевірити gmail вручну: шукай лист від Cartesia з кодом для', email)
}
process.exit(0)
