import tls from 'tls'
const sock = tls.connect({ host: 'imap.gmail.com', port: 993, rejectUnauthorized: false })
sock.setEncoding('utf8')
let t0 = Date.now()
sock.on('data', (d) => {
  console.log('[RX]', JSON.stringify(d.toString('utf8').slice(0, 400)))
  if (Date.now() - t0 > 2500 && !sent) { sent = true; console.log('[TX LOGIN quoted]'); sock.write('A1 LOGIN "nameofsewar@gmail.com" "bvhm syil lcsd bgnu"\r\n') }
  if (Date.now() - t0 > 9000) { sock.end(); process.exit(0) }
})
let sent = false
console.log('waiting greeting...')
