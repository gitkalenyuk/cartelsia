import tls from 'tls'
const sock = tls.connect({ host: 'imap.gmail.com', port: 993, rejectUnauthorized: false })
sock.setEncoding('utf8')
let phase = 0
sock.on('data', (d) => {
  const s = d.toString('utf8')
  console.log('[RX]', JSON.stringify(s.slice(0, 220)))
  if (phase === 0 && s.includes('* OK')) {
    phase = 1
    console.log('[TX] LOGIN no-spaces')
    sock.write('A1 LOGIN "nameofsewar@gmail.com" "bvhmsyillcsdbgnu"\r\n')
  }
  if (phase === 1 && /A1 (OK|NO|BAD)/.test(s)) {
    phase = 2
    console.log('LOGIN result captured')
    setTimeout(() => { sock.end(); process.exit(0) }, 200)
  }
  if (Date.now() - t0 > 12000) { sock.end(); process.exit(0) }
})
const t0 = Date.now()
