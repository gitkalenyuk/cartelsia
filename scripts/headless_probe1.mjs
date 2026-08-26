// Headless probe (очистка): Clerk sign_up -> email_code -> IMAP код -> attempt_verification
import tls from 'tls'
const BASE = 'https://clerk.cartesia.ai'
const QS = '__clerk_api_version=2026-05-12&_clerk_js_version=6.30.1'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
const IMAP = { host: 'imap.gmail.com', port: 993, user: 'nameofsewar@gmail.com', pass: 'bvhm syil lcsd bngu' }
const email = 'nameofsewar+hlprobe' + Date.now().toString(36) + '@gmail.com'
const H = { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Origin: 'https://play.cartesia.ai', Referer: 'https://play.cartesia.ai/sign-in/create' }
const form = (o) => new URLSearchParams(o).toString()
console.log('EMAIL', email)

let res = await fetch(BASE + '/v1/client/sign_ups?' + QS, { method: 'POST', headers: H, body: form({ email_address: email, first_name: 'Alex', last_name: 'Cartel', password: 'Probe_Ab12cd!9', locale: 'en-US' }) })
let b = await res.text()
const j1 = JSON.parse(b)
const suaId = j1.meta?.client?.sign_up?.id
console.log('1) sign_ups=' + res.status, 'sua=' + suaId, 'errors=', JSON.stringify(j1.errors || null))
if (!suaId) { console.log(b.slice(0, 400)); process.exit(1) }

res = await fetch(BASE + '/v1/client/sign_ups/' + suaId + '/prepare_verification?' + QS, { method: 'POST', headers: H, body: form({ strategy: 'email_code' }) })
b = await res.text()
console.log('2) prepare_verification=' + res.status, 'errors=', (b.match(/"errors":\[[^\]]*\]/) || ['none'])[0].slice(0, 160))

// ---- мінімальний IMAP ----
function imapSession() {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host: IMAP.host, port: IMAP.port, rejectUnauthorized: false })
    const session = {
      sock,
      buffer: '',
      seq: 0,
      exec(cmd) {
        const tag = 'T' + (++this.seq)
        const line = tag + ' ' + cmd
        return new Promise((res2, rej2) => {
          const onData = (d) => {
            this.buffer += d.toString('utf8')
            const lines = this.buffer.split('\r\n')
            for (const l of lines) {
              if (l.startsWith(tag + ' OK')) { const out = this.buffer; this.buffer = ''; sock.off('data', onData); res2(out); return }
              if (l.startsWith(tag + ' NO') || l.startsWith(tag + ' BAD')) { sock.off('data', onData); rej2(new Error(line)); return }
            }
          }
          sock.on('data', onData)
          sock.write(line + '\r\n')
          setTimeout(() => rej2(new Error('imap timeout ' + cmd)), 15000)
        })
      }
    }
    let greeting = ''
    sock.setEncoding('utf8')
    sock.on('data', (d) => {
      greeting += d
      if (greeting.includes('* OK')) {
        sock.off('data', undefined)
        resolve(session)
      }
    })
    sock.on('error', (e) => reject(e))
    setTimeout(() => reject(new Error('greet timeout')), 10000)
    // data handler conflict: exec додає свои listeners по кожен виклик — ок
  })
}

async function findCode() {
  let s
  try { s = await imapSession() } catch (e) { return { err: 'connect: ' + e.message } }
  try {
    await s.exec('LOGIN "' + IMAP.user + '" "' + IMAP.pass + '"')
    await s.exec('SELECT INBOX')
    const now = new Date()
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const d = String(now.getDate()).padStart(2, '0') + '-' + months[now.getMonth()] + '-' + now.getFullYear()
    let search = await s.exec('UID SEARCH SINCE ' + d).catch(() => '* SEARCH')
    let uids = (search.match(/\* SEARCH\s+([0-9\s]+)/)?.[1] || '').trim().split(/\s+/).filter(Boolean)
    if (!uids.length) return { ok: false }
    const recent = uids.slice(-8).reverse()
    for (const uid of recent) {
      const f = await s.exec('UID FETCH ' + uid + ' (BODY.PEEK[HEADER.FIELDS (TO DELIVERED-TO SUBJECT DATE)] BODY.PEEK[TEXT])').catch(() => '')
      const low = f.toLowerCase()
      if (!low.includes(email)) continue
      const qpb = f.replace(/=3D/gi, '=').replace(/=[0-9A-Fa-f]{2}/g, (m) => String.fromCharCode(parseInt(m.slice(1), 16)));
      let text = qpb
      // базовий base64: шукаємо частину text/plain base64
      const b64m = f.match(/text\/plain;?\s*[^=\r\n]*base64[^\r\n]*\r\n([\s\S]+?)(?=\r\n\r\n--|\r\nT\d+ OK|$)/i) || f.match(/base64\r\n([A-Za-z0-9+/=\r\n]{200,})/i)
      if (b64m) { try { text += Buffer.from(b64m[1].replace(/\s+/g, ''), 'base64').toString('utf8') } catch {} }
      const code = (text.match(/<b[^>]*>\s*(\d{6})\s*<\/b>/i) || text.match(/verification\s+code[:\s](\d{6})/i) || text.match(/(?:code|otp)[^0-9]{0,24}(\d{6})/i))?.[1]
      const subj = (f.match(/Subject:.*$/im) || [''])[0]
      if (code) { s.exec('LOGOUT').catch(() => {}); s.sock.end(); return { code, subj: subj.slice(0, 80) } }
    }
    s.exec('LOGOUT').catch(() => {}); s.sock.end()
    return { ok: false }
  } catch (e) { try { s.sock.destroy() } catch {}; return { err: e.message } }
}

let found = null
const t0 = Date.now()
while (Date.now() - t0 < 150000) {
  await new Promise((r) => setTimeout(r, 8000))
  found = await findCode()
  console.log('3) IMAP poll ' + Math.round((Date.now() - t0) / 1000) + 's ->', JSON.stringify(found))
  if (found.code || found.err) break
}
if (!found || !found.code) { console.log('NO_CODE_TIMEOUT'); process.exit(1) }

res = await fetch(BASE + '/v1/client/sign_ups/' + suaId + '/attempt_verification?' + QS, { method: 'POST', headers: H, body: form({ verification_code: found.code, strategy: 'email_code' }) })
b = await res.text()
const j3 = res.ok ? JSON.parse(b) : {}
console.log('4) attempt_verification=' + res.status, 'session_id=', j3.meta?.created_session_id || j3.meta?.client?.sessions?.[0]?.id, 'errors=', JSON.stringify(j3.errors || null).slice(0, 300))
const cks = res.headers.getSetCookie ? res.headers.getSetCookie() : []
for (const c of cks) console.log('COOKIE:', c.split(';')[0].slice(0, 80) + ' ...')
console.log('FINAL_EMAIL', email)
