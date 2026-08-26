import tls from 'tls'
const IMAP = { host: 'imap.gmail.com', port: 993, user: 'nameofsewar@gmail.com', pass: 'bvhm syil lcsd bgnu' }
function connect() {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host: IMAP.host, port: 993, rejectUnauthorized: false })
    let lineBuf = ''
    let cur = null
    sock.setEncoding('utf8')
    sock.on('data', (d) => {
      lineBuf += d
      let idx
      while ((idx = lineBuf.indexOf('\r\n')) >= 0) {
        const line = lineBuf.slice(0, idx); lineBuf = lineBuf.slice(idx + 2)
        if (line.startsWith('* OK') && !cur) { resolve({ sock, send: sendCmd }); continue }
        const m = line.match(/^(C\d+_\w*) (OK|NO|BAD|PREAUTH)(.*)$/i)
        if (cur && m && m[1] === cur.tag) { const c = cur; cur = null; c.finish(line) }
        else if (cur) cur.data += line + '\r\n'
      }
    })
    sock.on('error', reject)
    let seq = 0
    function sendCmd(c) {
      return new Promise((res, rej) => {
        const tag = 'C' + (++seq) + '_'
        cur = { tag, data: '', finish: (l) => res(cur2data + '\r\n' + l) }
        // simpler: collect via closure
        const p = { tag, data: '' }
        cur = { tag: p.tag, finish: (l) => { p.data += l + '\r\n'; res(p.data) } , get data() { return p.data }, set data(v) { p.data = v } }
        cur.data = ''
        const to = setTimeout(() => { cur = null; rej(new Error('timeout ' + c)) }, 30000)
        p.finish_ = cur.finish
        // override: clear timer on finish
        const f2 = cur.finish
        cur.finish = (l) => { clearTimeout(to); f2(l) }
        sock.write(tag + ' ' + c + '\r\n')
      })
    }
  })
}
const s = await connect()
let out = await s.sendCmd('LOGIN "nameofsewar@gmail.com" "bvhm syil lcsd bgnu"')
console.log('LOGIN:', out.trim().slice(-80))
if (/ok/i.test(out)) {
  out = await s.sendCmd('SELECT INBOX')
  console.log('SELECT:', out.replace(/\s+/g, ' ').slice(0, 200))
  out = await s.sendCmd('UID FETCH 1:3 (UID INTERNALDATE BODY.PEEK[HEADER.FIELDS (TO SUBJECT)])')
  console.log('FETCH:', out.replace(/\s+/g, ' ').slice(0, 600))
}
s.sock.end(); process.exit(0)
