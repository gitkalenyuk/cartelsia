import tls from 'node:tls'

const USER = 'nameofsewar@gmail.com'
const PASS = 'kvti mrvs iqmr wufe'
const TARGETS = ['cartelia_mt8mk1ht_7ash@furia.ink','cartelia_mt8mk1hu_6pa3@furia.ink','cartelia_mt8mk1hu_xfgj@furia.ink','cartelia_mt8mk1hu_hx1s@furia.ink','cartelia_mt8mk1hu_aqg9@furia.ink','cartelia_mt8mk1hu_kiti@furia.ink','cartelia_mt8mk1hu_xhcl@furia.ink','cartelia_mt8mk1hu_dp4u@furia.ink','cartelia_mt8kb1dc_7b6e@furia.ink','cartelia_mt8kb1dc_umyo@furia.ink','cartelia_mt8ltbpf_65kb@furia.ink']

class S {
  constructor(sock) { this.socket = sock; this.buffer = '' }
  readUntil(fn) {
    return new Promise((res) => {
      const handler = (data) => {
        this.buffer += data.toString('utf8')
        for (const line of this.buffer.split('\\r\\n')) if (fn(line)) { this.socket.off('data', handler); res(); return }
      }
      this.socket.on('data', handler)
    })
  }
  exec(cmd) {
    const tag = cmd.split(' ')[0]
    return new Promise((resolve, reject) => {
      const handler = (data) => {
        this.buffer += data.toString('utf8')
        for (const line of this.buffer.split('\\r\\n')) {
          if (line.startsWith(tag + ' OK')) { const out = this.buffer; this.buffer = ''; this.socket.off('data', handler); clearTimeout(t); resolve(out); return }
          if (line.startsWith(tag + ' NO') || line.startsWith(tag + ' BAD')) { this.socket.off('data', handler); clearTimeout(t); reject(new Error('IMAP ' + tag + ': ' + line.slice(0, 120))); return }
        }
      }
      const t = setTimeout(() => reject(new Error('IMAP timeout ' + cmd)), 25000)
      this.socket.on('data', handler)
      this.socket.write(cmd + '\\r\\n')
    })
  }
  close() { try { this.socket.destroy() } catch {} }
}

const sock = tls.connect({ host: 'imap.gmail.com', port: 993, rejectUnauthorized: false }, async () => {
  const s = new S(sock)
  await s.readUntil((l) => l.startsWith('* OK'))
  await s.exec('A0 LOGIN "' + USER + '" "' + PASS + '"')
  await s.exec('B1 SELECT INBOX')
  let uids = []
  try {
    const r1 = await s.exec('B2 UID SEARCH SINCE 25-Aug-2026 FROM "cartesia.ai"')
    uids = (r1.match(/\\* SEARCH\\s+([0-9\\s]+)/) || [])[1]?.trim().split(/\\s+/).filter(Boolean) ?? []
  } catch (e) { console.log('cartesia search failed:', e.message) }
  let allToday = []
  try {
    const r2 = await s.exec('B3 UID SEARCH SINCE 25-Aug-2026')
    allToday = (r2.match(/\\* SEARCH\\s+([0-9\\s]+)/) || [])[1]?.trim().split(/\\s+/).filter(Boolean) ?? []
  } catch {}
  console.log('FROM cartesia.ai today:', uids.length, '| all mail today:', allToday.length)

  const todo = uids.slice(-80).reverse()
  for (const uid of todo) {
    let raw = ''
    try {
      raw = await s.exec('B4 UID FETCH ' + uid + ' (BODY[HEADER.FIELDS (INTERNALDATE DATE FROM TO DELIVERED-TO X-ENVELOPE-TO X-ORIGINAL-TO SUBJECT)])')
    } catch (e) { console.log('fetch fail uid', uid, e.message); continue }
    const from = (raw.match(/From:\\s*([^\\r\\n]+)/i) || [])[1]?.trim()
    const internal = (raw.match(/INTERNALDATE\\s+"?([^" ]+)/i) || [])[1]
    const dHdr = (raw.match(/Date:\\s*([^\\r\\n]+)/i) || [])[1]?.trim()
    const subj = (raw.match(/Subject:\\s*([^\\r\\n]+)/i) || [])[1]?.trim()
    const toStart = raw.search(/\\bTo:/i)
    const to = toStart >= 0 ? (raw.slice(toStart).match(/To:\\s+([\\s\\S]*?)(?=\\r\\n[A-Z][a-z0-9-]+:|\\r\\nB[0-9]|$)/i) || ['',''])[1].replace(/\\s+/g, ' ').trim().slice(0, 130) : ''
    const lower = raw.toLowerCase()
    const hits = TARGETS.filter((t) => to.includes(t) || lower.includes(t))
    let code = ''
    try {
      const body = await s.exec('B5 UID FETCH ' + uid + ' (BODY[TEXT]<0.9000>)')
      code = (body.match(/\\b(\\d{6})\\b/) || [])[1] || ''
    } catch {}
    console.log([uid, internal || '', (from || '').slice(0, 55), to.slice(0, 85), (subj || '').slice(0, 45), 'code6=' + code, hits.length ? 'HIT ' + hits.map((h) => h.slice(14, 24)).join(',') : ''].join(' | '))
  }
  s.close()
  setTimeout(() => process.exit(0), 200)
})
sock.on('error', (e) => { console.error('SOCKET ERR', e.message); process.exit(1) })
setTimeout(() => { console.error('GLOBAL TIMEOUT'); process.exit(2) }, 150000)