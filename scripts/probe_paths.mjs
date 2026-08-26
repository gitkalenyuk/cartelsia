// Контролі: який шлях/api_version існує для attempt_completion (без IMAP, без коду)
const BASE = 'https://clerk.cartesia.ai'
const QS = '__clerk_api_version=2026-05-12&_clerk_js_version=6.30.1'
const H = { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36', Origin: 'https://play.cartesia.ai', Referer: 'https://play.cartesia.ai/sign-in/create' }
const t = Date.now().toString(36)
const email = 'furia_' + t + '@furia.ink'
const r1 = await fetch(BASE + '/v1/client/sign_ups?' + QS, { method: 'POST', headers: H, body: new URLSearchParams({ email_address: email, first_name: 'Alex', last_name: 'Cartel', password: 'Furia_' + t.slice(-3).toUpperCase() + 'ab1!9', locale: 'en-US' }).toString() })
const j1 = await r1.json()
const suaId = j1.response?.id
const ck = r1.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
console.log('sua=' + suaId + ' email=' + email)
const calls = [
  ['GET /v1/client (sanity)', 'GET', '/v1/client?' + QS, null],
  ['POST attempt_completion QS-2026-05-12', 'POST', '/v1/client/sign_ups/' + suaId + '/attempt_completion?' + QS, new URLSearchParams({ strategy: 'email_code' }).toString()],
  ['POST attempt_completion NO QS', 'POST', '/v1/client/sign_ups/' + suaId + '/attempt_completion', new URLSearchParams({ strategy: 'email_code' }).toString()],
  ['POST attempt_completion api 2025-10-01', 'POST', '/v1/client/sign_ups/' + suaId + '/attempt_completion?__clerk_api_version=2025-10-01&_clerk_js_version=6.30.1', new URLSearchParams({ strategy: 'email_code' }).toString()],
  ['POST attempt_completion api 2026-01-01', 'POST', '/v1/client/sign_ups/' + suaId + '/attempt_completion?__clerk_api_version=2026-01-01&_clerk_js_version=6.30.1', new URLSearchParams({ strategy: 'email_code' }).toString()],
  ['POST /complete QS-2026-05-12', 'POST', '/v1/client/sign_ups/' + suaId + '/complete?' + QS, new URLSearchParams({ strategy: 'email_code' }).toString()],
  ['POST /complete_verification QS-2026-05-12', 'POST', '/v1/client/sign_ups/' + suaId + '/complete_verification?' + QS, new URLSearchParams({ strategy: 'email_code' }).toString()],
  ['POST attempt_completion QS+empty body', 'POST', '/v1/client/sign_ups/' + suaId + '/attempt_completion?' + QS, ''],
]
for (const [name, method, path, body] of calls) {
  const r = await fetch(BASE + path, { method, headers: { ...H, Cookie: ck }, body: method === 'POST' ? body || undefined : undefined })
  const b = await r.text()
  console.log('\n' + name)
  console.log('  => ' + r.status + ' | ct=' + r.headers.get('content-type') + ' | server=' + r.headers.get('server'))
  console.log('  body: ' + b.slice(0, 260))
}
import fs from 'fs'
fs.writeFileSync('C:/Users/J0hnD03/AppData/Local/Temp/furia_paths.json', JSON.stringify({ suaId, email, cookie: ck }, null, 2))
console.log('\nSAVED furia_paths.json (сua + cookie переиспользуемые далі)')
