import tls from 'node:tls'
function loginProbe(user, pass, label) {
  return new Promise((resolve) => {
    const sock = tls.connect({ host: 'imap.gmail.com', port: 993, rejectUnauthorized: false }, () => {})
    let step = 0
    const to = setTimeout(() => { console.log(label + ': SILENCE'); sock.destroy(); resolve() }, 10000)
    sock.on('data', (d) => {
      const t = d.toString('utf8')
      if (step === 0 && t.includes('* OK')) {
        step = 1
        setTimeout(() => sock.write('A0 LOGIN "' + user + '" "' + pass + '"' + '\\r\\n'), 150)
      } else if (step === 1) {
        console.log(label + ': ' + JSON.stringify(t.slice(0, 200)))
        clearTimeout(to); sock.destroy(); resolve()
      }
    })
    sock.on('error', (e) => { console.log(label + ': ERR ' + e.message); clearTimeout(to); try{sock.destroy()}catch{}; resolve() })
  })
}
await loginProbe('nameofsewar@gmail.com', 'definitely-wrong-password-999', 'WRONG-PW: ')
await new Promise((r) => setTimeout(r, 6000))
await loginProbe('no.such.user.98765@gmail.com', 'definitely-wrong-password-999', 'WRONG-USER: ')
await new Promise((r) => setTimeout(r, 6000))
await loginProbe('nameofsewar@gmail.com', 'kvti mrvs iqmr wufe', 'REAL: ')
process.exit(0)