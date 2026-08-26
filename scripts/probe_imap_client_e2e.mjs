import { buildSync } from 'esbuild'
import { fileURLToPath } from 'url'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { pathToFileURL } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(os.tmpdir(), 'cartelsia-imapclient-e2e.mjs')
buildSync({
  entryPoints: [path.join(here, '..', 'src/main/email/imapClient.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: out
})
const { ImapClient } = await import(pathToFileURL(out).href)
const cfg = { host: 'imap.gmail.com', port: 993, user: 'nameofsewar@gmail.com', pass: 'kvti mrvs iqmr wufe', tls: true }
let ok = 0, fail = 0
for (let i = 1; i <= 5; i++) {
  const t0 = Date.now()
  const r = await ImapClient.testConnection(cfg)
  const ms = Date.now() - t0
  console.log('run ' + i + ': ' + (r.ok ? 'OK (testConnection: LOGIN + SELECT INBOX)' : 'FAIL ' + r.error) + ' [' + ms + 'ms]')
  if (r.ok) ok++; else fail++
}
try { fs.unlinkSync(out) } catch {}
console.log('RESULT: ' + ok + '/5 ok, ' + fail + ' failed')
