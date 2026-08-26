import tls from 'tls'
const BASE = 'https://clerk.cartesia.ai'
const QS = '__clerk_api_version=2026-05-12&_clerk_js_version=6.30.1'
const H = { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36', Origin: 'https://play.cartesia.ai', Referer: 'https://play.cartesia.ai/sign-in/create' }
const IMAP = { host: 'imap.gmail.com', port: 993, user: 'nameofsewar@gmail.com', pass: 'kvti mrvs iqmr wufe' }
const t = Date.now().toString(36)
const email = 'furia_' + t + '@furia.ink'
console.log('EMAIL:', email)
const t_all = Date.now()

const r1 = await fetch(BASE + '/v1/client/sign_ups?' + QS, { method: 'POST', headers: H, body: new URLSearchParams({ email_address: email, first_name: 'Alex', last_name: 'Cartel', password: 'Furia_' + t.slice(-3).toUpperCase() + 'ab1!9', locale: 'en-US' }).toString() })
const j1 = await r1.json()
const suaId = j1.response?.id
const ck = (r1.headers.getSetCookie ? r1.headers.getSetCookie() : []).map(c => c.split(';')[0]).join('; ')
console.log('1) sign_ups=' + r1.status, 'sua=' + suaId, 'client_cookie=' + (ck.includes('__client=') ? 'yes' : 'NO!'))

const r2 = await fetch(BASE + '/v1/client/sign_ups/' + suaId + '/prepare_verification?' + QS, { method: 'POST', headers: { ...H, Cookie: ck }, body: new URLSearchParams({ strategy: 'email_code' }).toString() })
console.log('2) prepare=' + r2.status)

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
if (!/ OK /.test(lo)) { console.log('LOGIN FAILED'); process.exit(1) }
await s.cmd('SELECT INBOX')
const MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const nD = new Date()
const since = String(nD.getDate()).padStart(2, '0') + '-' + MN[nD.getMonth()] + '-' + nD.getFullYear()
let code = null
const t0 = Date.now()
while (Date.now() - t0 < 180000 && !code) {
  const so = await s.cmd('UID SEARCH SINCE ' + since)
  const uids = (so.match(/SEARCH\s+([\d\s]+)/)?.[1] || '').trim().split(/\s+/).filter(Boolean)
  for (const uid of uids.slice(-6).reverse()) {
    const f = await s.cmd('UID FETCH ' + uid + ' (BODY.PEEK[HEADER.FIELDS (TO)] BODY.PEEK[TEXT])')
    const dec = f.replace(/=3D/g, '=').replace(/[0-9a-fA-F]{2}=/g, (m) => { const c = parseInt(m.slice(0,2),16); return (c>=32 && c<127)?String.fromCharCode(c):'?' })
    const to = (dec.match(/To[:(]\s*([^\r\n]+)/i) || [''])[0].trim()
    if (!to.includes(email)) continue
    const d2 = dec.match(/>(\d{6})</)
    if (d2) { console.log('3) CODE=' + d2[1]); code = d2[1] }
  }
  if (!code) { const el = Math.round((Date.now()-t0)/1000); if (el % 30 < 7) console.log('   ...' + el + 's'); await new Promise(r => setTimeout(r, 6000)) }
}
if (!code) { console.log('NO CODE'); process.exit(1) }

const r4 = await fetch(BASE + '/v1/client/sign_ups/' + suaId + '/attempt_verification?' + QS, { method: 'POST', headers: { ...H, Cookie: ck }, body: new URLSearchParams({ code, strategy: 'email_code' }).toString() })
let j4 = null; try { j4 = JSON.parse(await r4.text()) } catch {}
console.log('4) verify=' + r4.status, 'missing=', JSON.stringify(j4?.response?.missing_fields))

const b = await fetch('https://cdn.protect.clerk.com/ins_2dkzDoDZRl1ShmWomHR110Rr5EY/c/1-7zmywbegcociodnsmychbuyfgm-xyoakknk2m6hctnsl3lcokaepa/bootstrap.js?v=6.30.1')
const bt = await b.text()
const token = (bt.match(/token:"(v1\.[^"]+)"/) || [])[1]
const r5 = await fetch(BASE + '/v1/client/sign_ups/' + suaId + '/attempt_completion?' + QS, { method: 'POST', headers: { ...H, Cookie: ck }, body: new URLSearchParams({ __clerk_protect_token: token, __clerk_protect_status: 'ok', __clerk_protect_cid: '1-7zmywbegcociodnsmychbuyfgm-xyoakknk2m6hctnsl3lcokaepa' }).toString() })
const b5 = await r5.text()
let j5 = null; try { j5 = JSON.parse(b5) } catch {}
console.log('5) attempt_completion=' + r5.status, 'status=', j5?.response?.status)
console.log('   session_id=', j5?.response?.first_factor_result?.session_id || j5?.meta?.created_session_id || 'none')
console.log('   body=', b5.slice(0, 400))
const cks = r5.headers.getSetCookie ? r5.headers.getSetCookie().map(c => c.split(';')[0]) : []
console.log('5) cookies:', cks.map(c => c.split('=')[0]).join(', '))
// session token cookie (client_token / __session_id)
const sessCk = cks.filter(c => /client_token|__session|__client=/.test(c))
import fs from 'fs'
fs.writeFileSync('C:/Users/J0hnD03/AppData/Local/Temp/furia_e2e_final.json', JSON.stringify({ email, suaId, totalSec: Math.round((Date.now() - t_all) / 1000), completionStatus: r5.status, body: b5.slice(0, 2500), cookies: cks }, null, 2))
console.log('SAVED %TEMP%\furia_e2e_final.json')
s.cmd('LOGOUT').catch(() => {}); s.sock.end()
console.log('E2E FINAL DONE in ' + Math.round((Date.now() - t_all) / 1000) + 's')
