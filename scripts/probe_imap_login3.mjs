import tls from 'node:tls'
const USER = process.argv[2] || 'nameofsewar@gmail.com'
const PASS = process.argv[3] || 'kvti mrvs iqmr wufe'
const FAMILY = parseInt(process.argv[4] || '4', 10)
function tryLogin(n) {
  return new Promise((resolve) => {
    let got = ''
    const sock = tls.connect({ host: 'imap.gmail.com', port: 993, rejectUnauthorized: false, family: FAMILY }, () => {
      console.log('[' + n + '] connected (family ' + FAMILY + ') local=' + sock.localPort)
    })
    let step = 0
    const to = setTimeout(() => { console.log('[' + n + '] SILENCE 12s for LOGIN'); sock.destroy(); resolve() }, 12000)
    sock.on('data', (d) => {
      const t = d.toString('utf8')
      got += t
      if (step === 0 && t.includes('* OK')) {
        step = 1
        setTimeout(() => sock.write('A0 LOGIN "' + USER + '" "' + PASS + '"' + '\\r\\n'), 200)
      } else if (step === 1) {
        console.log('[' + n + '] LOGIN RESPONSE: ' + JSON.stringify(t.slice(0, 220)))
        clearTimeout(to); sock.destroy(); resolve()
      }
    })
    sock.on('error', (e) => { console.log('[' + n + '] ERR ' + e.message); clearTimeout(to); try { sock.destroy() } catch {}; resolve() })
  })
}
await tryLogin(1)
await new Promise((r) => setTimeout(r, 5000))
await tryLogin(2)
process.exit(0)