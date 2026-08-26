// E2E #5: sign_up → prepare → IMAP OTP → verify → attempt_completion (debug 404)
// Нове: (1) merge cookie-rotate з КОЖНОЇ відповіді, (2) варіанти body attempt_completion,
// (3) лог server/cf-ray header 404, (4) динамічний protect bootstrap, (5) GET /v1/client після успіху.
import tls from 'tls'
import fs from 'fs'
const BASE = 'https://clerk.cartesia.ai'
const QS = '__clerk_api_version=2026-05-12&_clerk_js_version=6.30.1'
const H = { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36', Origin: 'https://play.cartesia.ai', Referer: 'https://play.cartesia.ai/sign-in/create' }
const IMAP = { host: 'imap.gmail.com', port: 993, user: 'nameofsewar@gmail.com', pass: 'kvti mrvs iqmr wufe' }
const PROTECT_FALLBACK = 'https://cdn.protect.clerk.com/ins_2dkzDoDZRl1ShmWomHR110Rr5EY/c/1-7zmywbegcociodnsmychbuyfgm-xyoakknk2m6hctnsl3lcokaepa/bootstrap.js?v=6.30.1'
const t = Date.now().toString(36)
const email = 'furia_' + t + '@furia.ink'
console.log('EMAIL:', email)
const t_all = Date.now()

const ckMap = new Map()
let origCk = ''
function absorb(resp) {
  for (const c of resp.headers.getSetCookie ? resp.headers.getSetCookie() : []) {
    const pair = c.split(';')[0]
    const i = pair.indexOf('=')
    if (i > 0) ckMap.set(pair.slice(0, i), pair.slice(i + 1))
  }
  console.log('   +cookies now:', [...ckMap.keys()].join(','), '(n=' + ckMap.size + ')')
}
const cookieStr = () => [...ckMap.entries()].map(([k, v]) => k + '=' + v).join('; ')

async function clerk(path, body, opts = {}) {
  const ck = opts.original ? origCk : cookieStr()
  const r = await fetch(BASE + path, { method: 'POST', headers: { ...H, ...(!ck ? {} : { Cookie: ck }) }, body: body.toString() })
  const b = await r.text()
  console.log(path.replace(BASE, '').split('?')[0], '=>', r.status, '| server=' + r.headers.get('server'), '| cf-ray=' + (r.headers.get('cf-ray') || '-').slice(0, 24), '| ct=' + r.headers.get('content-type'))
  console.log('   body:', b.slice(0, 220))
  const j = (() => { try { return JSON.parse(b) } catch { return null } })()
  absorb(r)
  return { r, b, j, cookies: r.headers.getSetCookie ? r.headers.getSetCookie().map(c => c.split(';')[0]) : [] }
}

// 1) sign_up
const r1b = new URLSearchParams({ email_address: email, first_name: 'Alex', last_name: 'Cartel', password: 'Furia_' + t.slice(-3).toUpperCase() + 'ab1!9', locale: 'en-US' })
const s1 = await clerk('/v1/client/sign_ups?' + QS, r1b)
origCk = cookieStr()
const suaId = s1.j?.response?.id
console.log('1) sua=' + suaId, '__client in r1:', origCk.includes('__client=') ? 'YES (' + origCk.split('__client=')[1].slice(0, 40) + '...)' : 'NO!')
if (!suaId) { console.log('SIGN_UP FAILED'); process.exit(1) }
ckMap.clear(); for (const p of origCk.split('; ')) { const i = p.indexOf('='); if (i > 0) ckMap.set(p.slice(0, i), p.slice(i + 1)) }

// 2) prepare_verification
const s2 = await clerk('/v1/client/sign_ups/' + suaId + '/prepare_verification?' + QS, new URLSearchParams({ strategy: 'email_code' }))
console.log('2) missing=', JSON.stringify(s2.j?.response?.missing_fields))

// 3) IMAP OTP
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
if (!/ OK /.test(lo)) { console.log('3) LOGIN FAILED:', lo.slice(0, 200)); process.exit(1) }
await s.cmd('SELECT INBOX')
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const nD = new Date()
const since = String(nD.getDate()).padStart(2, '0') + '-' + MN[nD.getMonth()] + '-' + nD.getFullYear()
let code = null
const t0 = Date.now()
while (Date.now() - t0 < 180000 && !code) {
  const so = await s.cmd('UID SEARCH SINCE ' + since)
  const uids = (so.match(/SEARCH\s+([\d\s]+)/)?.[1] || '').trim().split(/\s+/).filter(Boolean)
  for (const uid of uids.slice(-6).reverse()) {
    const f = await s.cmd('UID FETCH ' + uid + ' (BODY.PEEK[HEADER.FIELDS (TO)] BODY.PEEK[TEXT])')
    const dec = f.replace(/=3D/g, '=').replace(/[0-9a-fA-F]{2}=/g, (m) => { const c = parseInt(m.slice(0, 2), 16); return (c >= 32 && c < 127) ? String.fromCharCode(c) : '?' })
    const to = (dec.match(/To[:(]\s*([^\r\n]+)/i) || [''])[0].trim()
    if (!to.includes(email)) continue
    const d2 = dec.match(/>(\d{6})</)
    if (d2) { console.log('3) CODE=' + d2[1]); code = d2[1] }
  }
  if (!code) { const el = Math.round((Date.now() - t0) / 1000); if (el % 30 < 7) console.log('   ...' + el + 's'); await new Promise(r => setTimeout(r, 6000)) }
}
if (!code) { console.log('3) NO CODE — IMAP wait exhausted'); process.exit(1) }

// 4) attempt_verification
const s4 = await clerk('/v1/client/sign_ups/' + suaId + '/attempt_verification?' + QS, new URLSearchParams({ code, strategy: 'email_code' }))
console.log('4) status=', s4.j?.response?.status, 'missing=', JSON.stringify(s4.j?.response?.missing_fields))

// protect token (dynamic bootstrap from live page, fallback hardcoded)
let protect = { token: null, cid: null, url: null }
try {
  const ph = await fetch('https://play.cartesia.ai/sign-in/create', { headers: { 'User-Agent': H['User-Agent'] } }).then(r => r.text())
  const m = ph.match(/(ins_[A-Za-z0-9]+)\/c\/([\w.-]+)\/bootstrap\.js/)
  if (m) protect.url = 'https://cdn.protect.clerk.com/' + m[1] + '/c/' + m[2] + '/bootstrap.js?v=6.30.1'
} catch {}
if (!protect.url) protect.url = PROTECT_FALLBACK
try {
  const bt = await fetch(protect.url, { headers: { 'User-Agent': H['User-Agent'] } }).then(r => r.text())
  console.log('protect bootstrap len=', bt.length, '| head=', bt.slice(0, 120))
  const mt = bt.match(/token:"(v1\.[^"]+)"/)
  protect.token = mt?.[1] || null
  protect.cid = (protect.url.match(/c\/([\w.-]+)/) || [])[1]
  console.log('protect token=', protect.token ? protect.token.slice(0, 50) + '...' : 'NOT FOUND', 'cid=', protect.cid)
} catch (e) { console.log('protect fetch failed:', e?.message) }

// 5) attempt_completion — variants
const variants = []
function P(extra = {}) {
  const p = new URLSearchParams()
  if (protect.token) { p.set('__clerk_protect_token', protect.token); p.set('__clerk_protect_status', 'ok'); if (protect.cid) p.set('__clerk_protect_cid', protect.cid) }
  for (const [k, v] of Object.entries(extra)) p.set(k, v)
  return p
}
const V = [
  ['V1 protect+strategy, merged ck', P({ strategy: 'email_code' }), { original: false }],
  ['V2 protect only, merged ck', P({}), { original: false }],
  ['V3 strategy only, ORIGINAL r1 ck', new URLSearchParams({ strategy: 'email_code' }), { original: true }],
  ['V4 protect only, ORIGINAL r1 ck', P({}), { original: true }],
]
let done = null
for (const [name, body, opts] of V) {
  const res = await clerk('/v1/client/sign_ups/' + suaId + '/attempt_completion?' + QS, body, opts)
  variants.push({ name, status: res.r.status, server: res.r.headers.get('server'), body: res.b.slice(0, 600), cookies: res.cookies.map(c => c.split('=')[0]) })
  console.log('***', name, '->', res.r.status)
  if (res.r.status === 200 && res.j?.response) { done = res; break }
  if (res.j) break // Clerk JSON error (не plain 404) — далі пробувати нема сенсу
}
if (done) {
  const rp = done.j.response
  console.log('SUCCESS status=', rp.status)
  console.log('session_id=', rp.first_factor_result?.session_id || rp.meta?.created_session_id)
  const sc = done.cookies.map(c => c.split(';')[0])
  console.log('set-cookie on success:', sc.map(c => c.split('=')[0]).join(', '))
  const ct = sc.find(c => c.startsWith('client_token='))
  const clientTok = ct ? ct.split('=').slice(1).join('=') : null
  if (clientTok) {
    const g = await fetch(BASE + '/v1/client?client_token=' + encodeURIComponent(clientTok) + '&' + QS, { headers: { 'User-Agent': H['User-Agent'] } })
    const gj = await g.json().catch(() => null)
    console.log('GET /v1/client =', g.status, 'session_id=', gj?.response?.session_id, 'user_id=', gj?.response?.user_id, 'client_status=', gj?.response?.status)
    done.sessionToken = clientTok
    done.clientJson = gj?.response || null
  }
  const sessCk = sc.find(c => c.startsWith('__client='))
  done.__client = sessCk || null
}
fs.writeFileSync('C:/Users/J0hnD03/AppData/Local/Temp/furia_e2e5.json', JSON.stringify({ email, suaId, totalSec: Math.round((Date.now() - t_all) / 1000), protect: { url: protect.url, token: protect.token ? protect.token.slice(0, 80) : null, cid: protect.cid }, variants, success: done ? { status: done.r.status, response: done.j?.response, sessionToken: done.sessionToken || null, __client: done.__client || null } : null }, null, 2))
console.log('SAVED TEMP furia_e2e5.json')
s.cmd('LOGOUT').catch(() => {}); s.sock.end()
console.log('E2E5 DONE in ' + Math.round((Date.now() - t_all) / 1000) + 's')
