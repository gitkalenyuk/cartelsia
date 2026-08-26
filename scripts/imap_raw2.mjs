import tls from 'tls'
const sock = tls.connect({ host: 'imap.gmail.com', port: 993, rejectUnauthorized: false })
sock.setEncoding('utf8')
let phase = 0
sock.on('data', (d) => {
  const s = d.toString('utf8')
  console.log('[+t' + Math.round((Date.now() - t0) / 100) + 'ms RX]', JSON.stringify(s.slice(0, 300)))
  if (phase === 0 && s.includes('* OK')) {
    phase = 1
    console.log('[TX] LOGIN quoted')
    sock.write('A1 LOGIN "nameofsewar@gmail.com" "bvhm syil lcsd bgnu"\r\n')
  }
  if (phase === 1 && /A1 (OK|NO|BAD)/.test(s)) {
    phase = 2
    console.log('[TX] SELECT INBOX')
    sock.write('A2 SELECT INBOX\r\n')
  }
  if (phase === 2 && /A2 (OK|NO|BAD)/.test(s)) {
    phase = 3
    setTimeout(() => { console.log('DONE'); sock.end(); process.exit(0) }, 300)
  }
  if (phase === 3) { setTimeout(() => { sock.end(); process.exit(0) }, 500) }
  if (phase < 3 && Date.now() - t0 > 15000) { console.log('TIMEOUT at phase', phase); sock.end(); process.exit(0) }
})
const t0 = Date.now()
