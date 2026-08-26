import tls from 'node:tls'
const sock = tls.connect({ host: 'imap.gmail.com', port: 993, rejectUnauthorized: false }, () => console.log('connected'))
let step = 0
const seq = [
  ['A0 CAPABILITY', 'A0'],
  ['A1 NOOP', 'A1'],
  ['A2 LOGIN "nameofsewar@gmail.com" "kvti mrvs iqmr wufe"', 'A2'],
]
sock.on('data', (d) => {
  const t = d.toString('utf8')
  console.log('SERVER: ' + JSON.stringify(t.slice(0, 250)))
  if (step === 0 && t.includes('* OK')) { step = 1; setTimeout(() => sock.write(seq[0][0] + '\\r\\n'), 200) }
  else if (step === 1 && t.includes('A0 ')) { step = 2; setTimeout(() => sock.write(seq[1][0] + '\\r\\n'), 500) }
  else if (step === 2 && t.includes('A1 ')) { step = 3; setTimeout(() => sock.write(seq[2][0] + '\\r\\n'), 500) }
  else if (step === 3 && t.includes('A2 ')) { step = 4 }
})
sock.on('close', () => console.log('SOCKET CLOSE'))
sock.on('error', (e) => console.error('ERR', e.message))
setTimeout(() => { console.log('done'); sock.destroy(); process.exit(0) }, 20000)