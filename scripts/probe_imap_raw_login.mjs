import tls from 'node:tls'
const sock = tls.connect({ host: 'imap.gmail.com', port: 993, rejectUnauthorized: false }, () => {
  console.log('connected, waiting greeting...')
})
let step = 0
sock.on('data', (d) => {
  const t = d.toString('utf8')
  console.log('[' + Date.now() % 100000 + '] SERVER: ' + JSON.stringify(t.slice(0, 300)))
  if (step === 0 && t.includes('* OK')) {
    step = 1
    setTimeout(() => { const cmd = 'A0 LOGIN "nameofsewar@gmail.com" "kvti mrvs iqmr wufe"'; console.log('CLIENT SENDS: ' + JSON.stringify(cmd)); sock.write(cmd + '\\r\\n') }, 300)
  }
  if (step === 1 && t.includes('A0 ')) { step = 2; }
})
sock.on('error', (e) => console.error('ERR', e.message))
setTimeout(() => { console.log('done, closing'); sock.destroy(); process.exit(0) }, 25000)