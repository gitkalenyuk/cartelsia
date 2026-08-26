import tls from 'node:tls'
let all = ''
class S {
  constructor(sock) { this.socket = sock; this.buffer = '' }
  readUntil(fn) {
    return new Promise((res) => {
      const handler = (data) => {
        this.buffer += data.toString('utf8')
        for (const line of this.buffer.split('\\r\\n')) if (fn(line)) { this.socket.off('data', handler); res(); return }
      }
      this.socket.on('data', handler)
    })
  }
  exec(cmd, ms) {
    const tag = cmd.split(' ')[0]
    return new Promise((resolve, reject) => {
      const handler = (data) => {
        this.buffer += data.toString('utf8')
        for (const line of this.buffer.split('\\r\\n')) {
          if (line.startsWith(tag + ' OK')) { const out = this.buffer; this.buffer = ''; this.socket.off('data', handler); clearTimeout(t); resolve(out); return }
          if (line.startsWith(tag + ' NO') || line.startsWith(tag + ' BAD')) { const out = this.buffer; this.buffer = ''; this.socket.off('data', handler); clearTimeout(t); reject(new Error('IMAP ' + tag + ': ' + line.slice(0, 160))); return }
        }
      }
      const t = setTimeout(() => { const out = this.buffer; this.buffer=''; this.socket.off('data', handler); reject(new Error('TIMEOUT ' + tag + ' | server said: ' + JSON.stringify(out.slice(-600)))) }, ms || 8000)
      this.socket.on('data', handler)
      this.socket.write(cmd + '\\r\\n')
    })
  }
}
const sock = tls.connect({ host: 'imap.gmail.com', port: 993, rejectUnauthorized: false }, async () => {
  const s = new S(sock)
  sock.on('data', (d) => { all += d.toString('utf8'); if (all.length < 4000) process.stderr.write('RAW: ' + JSON.stringify(d.toString('utf8').slice(0, 400)) + '\\n') })
  await s.readUntil((l) => l.startsWith('* OK'))
  await s.exec('A0 LOGIN "nameofsewar@gmail.com" "kvti mrvs iqmr wufe"', 15000)
  console.log('LOGIN OK')
  s.socket.destroy()
  setTimeout(() => process.exit(0), 100)
})
sock.on('error', (e) => { console.error('SOCKET ERR', e.message); process.exit(1) })
setTimeout(() => { console.error('GLOBAL TIMEOUT'); process.exit(2) }, 60000)