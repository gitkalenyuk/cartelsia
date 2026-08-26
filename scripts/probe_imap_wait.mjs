import tls from 'node:tls'
function probe(label) {
  return new Promise((resolve) => {
    const sock = tls.connect({ host: 'imap.gmail.com', port: 993, rejectUnauthorized: false }, () => {})
    let step = 0
    const to = setTimeout(() => { console.log(label + ': SILENCE'); sock.destroy(); resolve(false) }, 10000)
    sock.on('data', (d) => {
      const t = d.toString('utf8')
      if (step === 0 && t.includes('* OK')) {
        step = 1
        setTimeout(() => sock.write('A0 CAPABILITY' + '\\r\\n'), 150)
      } else if (step === 1) {
        console.log(label + ': CAPABILITY -> ' + JSON.stringify(t.slice(0, 160)))
        clearTimeout(to); sock.destroy(); resolve(true)
      }
    })
    sock.on('error', (e) => { console.log(label + ': ERR ' + e.message); clearTimeout(to); try{sock.destroy()}catch{}; resolve(false) })
  })
}
console.log('waiting 90s for Gmail throttle to decay...')
await new Promise((r) => setTimeout(r, 90000))
console.log('attempt 1:'); await probe('A1')
await new Promise((r) => setTimeout(r, 8000))
console.log('attempt 2:'); await probe('A2')
process.exit(0)