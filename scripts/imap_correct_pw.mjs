import tls from 'tls'
const sock = tls.connect({ host: 'imap.gmail.com', port: 993, rejectUnauthorized: false })
sock.setEncoding('utf8')
let phase = 0
sock.on('data', (d) => {
  const s = d.toString('utf8')
  console.log('[RX]', JSON.stringify(s.slice(0, 260)))
  if (phase === 0 && s.includes('* OK')) { phase = 1; sock.write('A1 LOGIN "nameofsewar@gmail.com" "kvti mrvs iqmr wufe"\r\n') }
  if (phase === 1 && /A1 (OK|NO|BAD)/.test(s)) {
    phase = 2
    if (/A1 OK/.test(s)) { console.log('LOGIN OK!'); sock.write('A2 SELECT INBOX\r\n') }
    else { sock.end(); process.exit(1) }
  }
  if (phase === 2 && /A2 (OK|NO|BAD)/.test(s)) {
    phase = 3
    const m = s.match(/\* (\d+) EXISTS/)
    console.log('INBOX messages:', m?.[1] || 'n/a')
    sock.write('A3 LIST "" "*"\r\n')
  }
  if (phase === 3 && /A3 (OK|NO|BAD)/.test(s)) { console.log('DONE'); sock.end(); process.exit(0) }
  if (Date.now() - t0 > 15000) { sock.end(); process.exit(0) }
})
const t0 = Date.now()
