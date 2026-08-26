// E2E #12: БЕЗБРАУЗЕРНИЙ ключ: GET /v1/client (cookie) → last_active_token.jwt → POST backend.cartesia.ai/keys
import fs from "fs"
const H = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36", Origin: "https://play.cartesia.ai", Referer: "https://play.cartesia.ai/keys" }
const saved = JSON.parse(fs.readFileSync("C:/Users/J0hnD03/AppData/Local/Temp/furia_e2e11_session.json", "utf8"))
const cookie = "__client=" + saved.clientCookie

const t0 = Date.now()
const r1 = await fetch("https://clerk.cartesia.ai/v1/client?__clerk_api_version=2026-05-12&_clerk_js_version=6.30.1", { headers: { ...H, Cookie: cookie } })
console.log("1) GET /v1/client=" + r1.status)
const j1 = await r1.json().catch(() => null)
const s0 = j1?.response?.sessions?.[0] || j1?.sessions?.[0]
const jwt = s0?.last_active_token?.jwt
console.log("2) session status=" + (s0?.status || "?") + " sid=" + (s0?.id || "?") + " jwt=" + (jwt ? jwt.length + " chars" : "NO"))
if (!jwt) { console.log("body: " + (await r1.text()).slice(0, 300)); process.exit(2) }

const r2 = await fetch("https://backend.cartesia.ai/keys", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer " + jwt, ...H },
  body: JSON.stringify({ description: "Browserless Test Key" })
})
console.log("3) POST /keys=" + r2.status)
const b2 = await r2.text()
console.log("4) resp: " + b2.slice(0, 600))
const m = b2.match(/sk_car_[A-Za-z0-9_-]{8,}/)
console.log("5) KEY=" + (m ? m[0] : "NONE") + " — " + Math.round((Date.now() - t0) / 1000) + "s")
fs.writeFileSync("C:/Users/J0hnD03/AppData/Local/Temp/furia_e2e12.json", JSON.stringify({ email: saved.email, status: r2.status, body: b2.slice(0, 800), key: m ? m[0] : null }, null, 2))
// GET теж перевіряємо (listing)
const r3 = await fetch("https://backend.cartesia.ai/keys", { headers: { "Authorization": "Bearer " + jwt, ...H } })
console.log("6) GET /keys=" + r3.status + " " + (await r3.text()).slice(0, 300))
