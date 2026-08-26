import tls from 'tls'
const IMAP = { host: 'imap.gmail.com', port: 993, user: 'nameofsewar@gmail.com', pass: 'bvhm syil lcsd bgnu' }

// Clean IMAP client: single data handler, explicit state
function connect() {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host: IMAP.host, port: IMAP.port, rejectUnauthorized: false })
    sock.setEncoding('utf8')
    let lineBuf = ''
    let curTag = null
    let curData = ''
    const cmd = (c) => new Promise((resC, rejC) => {
      const tag = 'C' + Date.now() + Math.floor(Math.random() * 100) + '_'
      curTag = tag
      curData = ''
      const to = setTimeout(() => rejC(new Error('imap timeout: ' + c)), 25000)
      const p = { tag, finish: (status, extra) => { clearTimeout(to); resC((curData ? curData + '\r\n' : '') + tag + ' ' + status + (extra ? ' ' + extra : '')) } }
      curCmd = p
      sock.write(tag + ' ' + c + '\r\n')
    })
    let curCmd = null
    sock.on('data', (d) => {
      lineBuf += d
      let idx
      while ((idx = lineBuf.indexOf('\r\n')) >= 0) {
        const line = lineBuf.slice(0, idx)
        lineBuf = lineBuf.slice(idx + 2)
        const m = line.match(/^(C\d+_\w*) (OK|NO|BAD)(.*)$/i)
        if (curCmd && m && m[1] === curCmd.tag) {
          const c = curCmd; curCmd = null; curTag = null
          c.finish(m[2], m[3].trim())
          continue
        }
        if (curTag) curData += line + '\r\n'
        if (!started && line.startsWith('* OK')) {
          started = true
          resolve({ sock, cmd })
        }
      }
    })
    sock.on('error', reject)
    let started = false
    setTimeout(() => reject(new Error('greet timeout')), 10000)
  })
}

const s = await connect()
let out = await s.cmd('LOGIN "' + IMAP.user + '" "' + IMAP.pass + '"')
console.log('LOGIN:', out.trim().slice(-60))
out = await s.cmd('SELECT INBOX')
console.log('SELECT:', (out.match(/\* (\d+) EXISTS/) || ['no EXISTS'])[1] ?? '?')
const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; const n = new Date()
const d = String(n.getDate()).padStart(2, '0') + '-' + months[n.getMonth()] + '-' + n.getFullYear()
out = await s.cmd('UID SEARCH SINCE ' + d)
console.log('SEARCH:', out.slice(0, 120).replace(/\s+/g, ' '))
const uids = out.match(/\* SEARCH[\s\S]*?(\d+)[\s\S]*$/)?.[1]
const uidList = (out.match(/SEARCH\s+([\d\s]+)/)?.[1] || '').trim().split(/\s+/).filter(Boolean)
console.log('uid count:', uidList.length)
let foundOtp = null
for (const uid of uidList.slice(-10).reverse()) {
  const f = await s.cmd('UID FETCH ' + uid + ' (BODY.PEEK[HEADER.FIELDS (TO SUBJECT DATE)] BODY.PEEK[TEXT])')
  const to = (f.match(/To: [^\r\n]*/i) || [''])[0]
  const sub = (f.match(/Subject: [^\r\n]*/i) || [''])[0]
  // decode headers (quoted-printable)
  const dec = (str) => str.replace(/[0-9a-fA-F]{2}=\r?\n/g, (m) => m.includes('r') ? '' : String.fromCharCode(parseInt(m.slice(0, 2), 16))).replace(/[0-9A-Fa-f]{2}=/g, (m) => String.fromCharCode(parseInt(m.slice(0, 2), 16)))
  const toD = dec(to).replace(/=\?utf-8\?q\?([^?]*)\?=/g, (_, q) => decodeURIComponent(q.replace(/_/g, ' %')).replace(/_ /g, ' '))
  console.log('UID ' + uid + ' | ' + toD.slice(0, 70) + ' | ' + sub.slice(0, 50))
  if (!foundOtp && /cartesia|verify/i.test(f) && /hlprob|mт8e/i.test(to)) {
    const digits = dec(f).match(/\b(\d{6})\b/)
    if (digits) foundOtp = { uid, code: digits[1] }
  }
}
console.log('FOUND_OTP:', JSON.stringify(foundOtp))
// try last 10 regardless
for (const uid of uidList.slice(-10).reverse()) {
  const f = await s.cmd('UID FETCH ' + uid + ' BODY.PEEK[TEXT]')
  if (/cartesia/i.test(f)) {
    const dec = f.replace(/[0-9A-F]{2}=/g, (m) => String.fromCharCode(parseInt(m.slice(0, 2), 16)))
    const digits = dec.match(/\b(\d{6})\b/g)
    console.log('CARTESIA MAIL uid=' + uid + ' 6-digit candidates=' + JSON.stringify(digits))
    const body = dec.replace(/\s+/g, ' ')
    console.log('  body snippet: ' + body.slice(0, 300))
  }
}
s.cmd('LOGOUT').catch(() => {})
s.sock.end()
process.exit(0)
