import tls from 'tls'
const BASE = 'https://clerk.cartesia.ai'
const QS = '__clerk_api_version=2026-05-12&_clerk_js_version=6.30.1'
const H = { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36', Origin: 'https://play.cartesia.ai', Referer: 'https://play.cartesia.ai/sign-in/create' }
const IMAP = { host: 'imap.gmail.com', port: 993, user: 'nameofsewar@gmail.com', pass: 'kvti mrvs iqmr wufe' }
const t = Date.now().toString(36)
const email = 'furia_' + t + '@furia.ink'
console.log('EMAIL:', email)

const r1 = await fetch(BASE + '/v1/client/sign_ups?' + QS, { method: 'POST', headers: H, body: new URLSearchParams({ email_address: email, first_name: 'Alex', last_name: 'Cartel', password: 'Furia_' + t.slice(-3).toUpperCase() + 'ab1!9', locale: 'en-US' }).toString() })
const j1 = await r1.json()
const suaId = j1.response?.id || j1.meta?.client?.sign_up?.id
const ck = (r1.headers.getSetCookie ? r1.headers.getSetCookie() : []).map(c => c.split(';')[0]).join('; ')
console.log('1) sign_ups=' + r1.status, 'sua=' + suaId)

const r2 = await fetch(BASE + '/v1/client/sign_ups/' + suaId + '/prepare_verification?' + QS, { method: 'POST', headers: { ...H, Cookie: ck }, body: new URLSearchParams({ strategy: 'email_code' }).toString() })
console.log('2) prepare_verification=' + r2.status)

function connect() {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host: IMAP.host, port: IMAP.port, rejectUnauthorized: false })
    sock.setEncoding('utf8')
    let lineBuf = '', active = null, grep = false, seq = 0
    sock.on('data', (d) => {
      lineBuf += d
      let idx
      while ((idx = lineBuf.indexOf('\r\n')) >= 0) {
        const line = lineBuf.slice(0, idx); lineBuf = lineBuf.slice(idx + 2)
        if (!grep && line.startsWith('* OK')) { grep = true; resolve({ sock, cmd }); continue }
        const m = line.match(/^(C\d+) (OK|NO|BAD)(?: \[([^\]]*)\])?\s?(.*)$/)
        if (active && m && m[1] === active.tag) { const a = active; active = null; a.res((a.data ? a.data + '\r\n' : '') + line) }
        else if (active) active.data += line + '\r\n'
      }
    })
    sock.on('error', reject)
    setTimeout(() => { if (!grep) reject(new Error('greet timeout')) }, 10000)
    function cmd(c) {
      return new Promise((res, rej) => {
        const tag = 'C' + (++seq)
        active = { tag, data: '', res }
        sock.write(tag + ' ' + c + '\r\n')
        setTimeout(() => { if (active && active.tag === tag) { active = null; rej(new Error('cmd timeout: ' + c)) } }, 30000)
      })
    }
  })
}
const s = await connect()
const lo = await s.cmd('LOGIN "' + IMAP.user + '" "' + IMAP.pass + '"')
if (!/ OK /.test(lo)) { console.log('LOGIN FAILED:', lo); process.exit(1) }
await s.cmd('SELECT INBOX')
const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const nowD = new Date()
const since = String(nowD.getDate()).padStart(2, '0') + '-' + monthNames[nowD.getMonth()] + '-' + nowD.getFullYear()

let code = null
const t0 = Date.now()
while (Date.now() - t0 < 240000 && !code) {
  const so = await s.cmd('UID SEARCH SINCE ' + since)
  const uids = (so.match(/SEARCH\s+([\d\s]+)/)?.[1] || '').trim().split(/\s+/).filter(Boolean)
  for (const uid of uids.slice(-6).reverse()) {
    const f = await s.cmd('UID FETCH ' + uid + ' (BODY.PEEK[HEADER.FIELDS (TO SUBJECT)] BODY.PEEK[TEXT])')
    const dec = f.replace(/=3D/g, '=').replace(/[0-9a-fA-F]{2}=/g, (m) => { const c = parseInt(m.slice(0, 2), 16); return (c >= 32 && c < 127) ? String.fromCharCode(c) : '?' })
    const to = (dec.match(/To[:(]\s*([^\r\n]+)/i) || [''])[0].trim()
    if (!to.includes(email)) continue   // СТРОГО наш емайл
    const digits = dec.match(/>\s*(\d{6})\s*</)
    console.log('  MAIL for our email! code=' + (digits ? digits[1] : '??'), 'to=' + to.slice(0, 60))
    if (digits) code = digits[1]
  }
  if (!code) { const el = Math.round((Date.now() - t0) / 1000); if (el % 30 < 7) console.log('   ...' + el + 's'); await new Promise(r => setTimeout(r, 6000)) }
}
if (!code) { console.log('NO CODE 240s'); s.sock.end(); process.exit(1) }

const r4 = await fetch(BASE + '/v1/client/sign_ups/' + suaId + '/attempt_verification?' + QS, { method: 'POST', headers: { ...H, Cookie: ck }, body: new URLSearchParams({ code, strategy: 'email_code' }).toString() })
const b4 = await r4.text()
let j4 = null; try { j4 = JSON.parse(b4) } catch {}
console.log('4) attempt_verification=' + r4.status)
console.log('   resp:', b4.slice(0, 500))
const ck4 = (r4.headers.getSetCookie ? r4.headers.getSetCookie() : []).map(c => c.split(';')[0])
console.log('   new cookies:', ck4.join(' | '))
// зберігаємо сесійну cookie
import fs from 'fs'
fs.writeFileSync(process.env.TEMP + '\furia_e2e_result.json', JSON.stringify({ email, suaId, status: r4.status, response: b4.slice(0, 2000), cookies: ck4, ua: H['User-Agent'] }, null, 2))
console.log('saved to %TEMP%\furia_e2e_result.json')
s.cmd('LOGOUT').catch(() => {}); s.sock.end()
console.log('E2E_DONE')
