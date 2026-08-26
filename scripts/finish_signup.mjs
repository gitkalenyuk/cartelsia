// Usage: node scripts/finish_signup.mjs <code> <sua_id>
const [codeArg, suaId] = process.argv.slice(2)
if (!codeArg || !suaId) { console.error('usage: node scripts/finish_signup.mjs <6-digit-code> <sua_...>'); process.exit(2) }
const BASE = 'https://clerk.cartesia.ai'
const QS = '__clerk_api_version=2026-05-12&_clerk_js_version=6.30.1'
const H = { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36', Origin: 'https://play.cartesia.ai', Referer: 'https://play.cartesia.ai/sign-in/create' }
const res = await fetch(BASE + '/v1/client/sign_ups/' + suaId + '/attempt_verification?' + QS, {
  method: 'POST', headers: H,
  body: new URLSearchParams({ verification_code: codeArg, strategy: 'email_code' }).toString(),
})
const text = await res.text()
let j = null; try { j = JSON.parse(text) } catch {}
console.log('attempt_verification =', res.status)
console.log('session_id =', j?.response?.first_factor_result?.session_id || j?.meta?.created_session_id || j?.data?.session?.id || JSON.stringify(j).slice(0, 200))
console.log('body =', text.slice(0, 500))
