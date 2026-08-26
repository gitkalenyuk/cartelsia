import tls from 'node:tls'
const USER = process.argv[2] || 'namoo.f5owar@gmail.com'
const PASS = process.argv[3] || 'kvti mrvs iqmr wufe'
const sock = tls.connect({ host: 'imap.gmail.com', port: 993, rejectUnauthorized: false }, () => {
  console.log('connected')
})
let step = 0
sock.on('data', (d) => {
  const t = d.toString('utf8')
  console.log('SERVER: ' + JSON.stringify(t.slice(0, 250)))
  if (step === 0 && t.includes('* OK')) {
    step = 1
    setTimeout(() => { console.log('CLIENT LOGIN as ' + USER); sock.write('A0 LOGIN "' + USER + '" "' + PASS + '"' + '\\r\\n') }, 300)
  }
})
sock.on('error', (e) => console.error('ERR', e.message))
setTimeout(() => { console.log('CLOSE (15s)'); sock.destroy(); process.exit(0) }, 15000)