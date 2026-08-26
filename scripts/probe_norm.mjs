import tls from 'tls'
const BASE = 'https://clerk.cartesia.ai'
const QS = '__clerk_api_version=2026-05-12&_clerk_js_version=6.30.1'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
const IMAP = { host: 'imap.gmail.com', port: 993, user: 'nameofsewar@gmail.com', pass: 'bvhm syil lcsd bgnu' }
const H = { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Origin: 'https://play.cartesia.ai', Referer: 'https://play.cartesia.ai/sign-in/create' }
const form = (o) => new URLSearchParams(o).toString()
const t = Date.now().toString(36)

async function trySignup(email) {
  const res = await fetch(BASE + '/v1/client/sign_ups?' + QS, { method: 'POST', headers: H, body: form({ email_address: email, first_name: 'Alex', last_name: 'Cartel', password: 'Probe_Ab12cd!9', locale: 'en-US' }) })
  const text = await res.text()
  let j = null; try { j = JSON.parse(text) } catch {}
  const suaId = j?.meta?.client?.sign_up?.id
  const err = j?.errors?.[0]?.message || ''
  console.log('sign_ups ' + email + ' => ' + res.status + (suaId ? ' OK sua=' + suaId : '' ) + (err ? ' ERR=' + err : ''))
  return { email, status: res.status, suaId, err }
}
const r1 = await trySignup('nameofsewar+' + t + 'x@gmail.com')
const r2 = await trySignup('totallyfresh_' + t + 'z@' + 'gmail.com')
console.log('--- IMAP ---')
class Imap {
  constructor() { this.seq = 0; this.pending = new Map(); this.cache = {}; this.cacheTag = null }
  static connect(host, port) {
    return new Promise((resolve, reject) => {
      const s = new Imap()
      const timer = setTimeout(() => reject(new Error('connect timeout')), 10000)
      s.sock = tls.connect({ host, port, rejectUnauthorized: false }, () => {})
      s.sock.setEncoding('utf8')
      let seen = false
      s.buf = ''
      s.sock.on('data', (d) => {
        if (!seen) { seen = true; clearTimeout(timer) }
        s.buf += d
        const lines = s.buf.split('\r\n')
        s.buf = lines.pop()
        if (!s.done) {
          s.done = lines.some(l => l.startsWith('* OK'))
          if (s.done) return resolve(s)
        }
        for (const line of lines) {
          const m = line.match(/^(T\d+) (OK|NO|BAD)\s?(.*)$/)
          if (m && s.pending.has(m[1])) {
            const p = s.pending.get(m[1]); s.pending.delete(m[1])
            s.pendingDelete = true
            setTimeout(() => p.resolve((s.cache[m[1]] || '') + line), 0)
          } else if (s.cacheTag) {
            s.cache[s.cacheTag] += line + '\r\n'
          }
        }
      })
      s.sock.on('error', (e) => { clearTimeout(timer); reject(e) })
    })
  }
  exec(cmd) {
    return new Promise((resolve, reject) => {
      const tag = 'T' + (++this.seq)
      this.pending.set(tag, null)
      this.cache[tag] = ''; this.cacheTag = tag
      this.sock.write(tag + ' ' + cmd + '\r\n')
      const to = setTimeout(() => { const p = this.pending.get(tag); if (p) { this.pending.delete(tag); if (typeof p === 'object' && p.resolve !== s.pending.get) p.resolve?.('(timeout ' + cmd + ')') } else { this.pending.delete(tag); resolve('(timeout ' + cmd + ')') } }, 25000)
      this.pending.set(tag, { resolve: (v) => { clearTimeout(to); resolve(v) } })
    })
  }
}
try {
  const s = await Imap.connect(IMAP.host, IMAP.port)
  console.log('greet: OK')
  let out = await s.exec('LOGIN ' + IMAP.user + ' ' + IMAP.pass)
  console.log('LOGIN:', out.slice(-50).trim())
  out = await s.exec('SELECT INBOX')
  const exists = out.match(/\* (\d+) EXISTS/)?.[1]
  console.log('INBOX EXISTS:', exists)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; const n = new Date()
  const d = String(n.getDate()).padStart(2, '0') + '-' + months[n.getMonth()] + '-' + n.getFullYear()
  out = await s.exec('UID SEARCH SINCE ' + d)
  const uids = (out.split('\\r\\n').flatMap(l => l.match(/\* SEARCH\s+([\d\s]+)/)?.[1] || [])).flatMap(x => x.trim().split(/\s+/)).filter(Boolean)
  console.log('UIDs today:', uids.length)
  // останні 6, newest first
  for (const uid of uids.slice(-6).reverse()) {
    const f = await s.exec('UID FETCH ' + uid + ' (BODY.PEEK[HEADER.FIELDS (TO SUBJECT DATE)] BODY.PEEK[TEXT])')
    const to = (f.match(/To: [^\r\n]*/i) || [''])[0]
    const sub = (f.match(/Subject: [^\r\n]*/i) || [''])[0]
    const codeM = (f.replace(/[0-9a-fA-F]{2}=\r\n/g, (m) => String.fromCharCode(parseInt(m.slice(0,2),16))).match(/>\s*(\d{6})\s*</) || f.replace(/=3D/g,'').match(/(\d{6})/))
    console.log('UID ' + uid + ' | ' + to.slice(0, 60) + ' | ' + sub.slice(0, 50) + (codeM ? ' | 6DIGIT=' + codeM[1] : ''))
  }
  s.exec('LOGOUT').catch(() => {}); s.sock.end()
  console.log('IMAP OK DONE')
} catch (e) {
  console.log('IMAP ERR:', e.message)
}
process.exit(0)
