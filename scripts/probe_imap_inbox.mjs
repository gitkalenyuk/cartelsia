import { buildSync } from 'esbuild'
import { fileURLToPath } from 'url'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { pathToFileURL } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(os.tmpdir(), 'cartelsia-imaplist.mjs')
buildSync({
  entryPoints: [path.join(here, '..', 'src/main/email/imapClient.ts')],
  bundle: true, platform: 'node', format: 'esm', outfile: out
})
const { openImapSession, parseSearchUids } = await import(pathToFileURL(out).href)
const cfg = { host: 'imap.gmail.com', port: 993, user: 'nameofsewar@gmail.com', pass: 'kvti mrvs iqmr wufe', tls: true }
const s = await openImapSession(cfg)
const r0 = await s.exec('A1 SELECT INBOX')
const m = r0.match(/\* OK.*?(\d+) EXISTS/)
console.log('INBOX EXISTS:', m ? m[1] : '?')
const since = new Date(Date.now() - 15 * 60 * 1000)
const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const d = since.getDate().toString().padStart(2, '0') + '-' + months[since.getMonth()] + '-' + since.getFullYear()
let uids = []
try { uids = parseSearchUids(await s.exec('A2 UID SEARCH SINCE ' + d + ' FROM "cartesia.ai"')) } catch (e) { console.log('search1 err', e.message) }
if (!uids.length) { try { uids = parseSearchUids(await s.exec('A3 UID SEARCH SINCE ' + d)) } catch (e) { console.log('search2 err', e.message) } }
console.log('mail in last 15min:', uids.length, uids.slice(0, 30).join(','))
const recent = uids.slice(-8).reverse()
for (const uid of recent) {
  const body = await s.exec('A4 UID FETCH ' + uid + ' (BODY[HEADER.FIELDS (SUBJECT TO FROM DATE)])')
  const subj = (body.match(/Subject: ([^\r\n]+)/i) || [])[1] || '(no subj)'
  const to = (body.match(/To: ([^\r\n]+)/i) || [])[1] || ''
  const from = (body.match(/From: ([^\r\n]+)/i) || [])[1] || ''
  const date = (body.match(/Date: ([^\r\n]+)/i) || [])[1] || ''
  console.log('UID ' + uid + ' | ' + date + ' | ' + from + ' | ' + to + ' | ' + subj)
}
s.close()
try { fs.unlinkSync(out) } catch {}
console.log('DONE')
