// E2E #8: ЧИСТИЙ BROWSERLESS — без Playwright. HTML -> bootstrap URL -> bootstrap.js -> regex token -> API.
// Питання: чи потрібен probe-report POST (спостереження) для приймання proof_token?
import tls from "tls"
import fs from "fs"
const BASE = "https://clerk.cartesia.ai"
const QS = "__clerk_api_version=2026-05-12&_clerk_js_version=6.30.1"
const H = { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36", Origin: "https://play.cartesia.ai", Referer: "https://play.cartesia.ai/sign-in/create" }
const IMAP = { host: "imap.gmail.com", port: 993, user: "nameofsewar@gmail.com", pass: "kvti mrvs iqmr wufe" }
const t_all = Date.now()

// --- 0) browserless: HTML -> bootstrap -> token ---
const html = await (await fetch("https://play.cartesia.ai/sign-in/create", { headers: { "User-Agent": H["User-Agent"] } })).text()
console.log("0) HTML len=" + html.length)
const bootUrls = [...new Set(html.match(/https?:\/\/[^"\s]+bootstrap\.js[^"\s]*/g) || [])]
console.log("0) bootstrap URLs (" + bootUrls.length + "): " + bootUrls.slice(0, 2).map(u => u.slice(0, 100)).join(" | "))
if (!bootUrls.length) { console.log("NO BOOTSTRAP URL in HTML — HTML head: " + html.slice(0, 300)); process.exit(1) }
const boot = await (await fetch(bootUrls[0], { headers: { "User-Agent": H["User-Agent"] } })).text()
console.log("0) bootstrap len=" + boot.length)
const tm = boot.match(/token:"(v1\.[^"]+)",exp:(\d+)/)
const cm = boot.match(/cid:"([^"]+)"/)
if (!tm || !cm) { console.log("NO TOKEN in bootstrap — head: " + boot.slice(0, 200)); process.exit(1) }
const PROOF = tm[1]
console.log("0) BROWSERLESS cid=" + cm[1])
console.log("0) BROWSERLESS token=" + PROOF.slice(0, 40) + "... exp=" + tm[2])
console.log("0) NO PROBES RUN — straight to API")

// --- clerk helpers ---
const ckMap = new Map()
function absorb(r) { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const p = c.split(";")[0]; const i = p.indexOf("="); if (i > 0) ckMap.set(p.slice(0, i), p.slice(i + 1)) } }
const cookieStr = () => [...ckMap.entries()].map(([k, v]) => k + "=" + v).join("; ")
async function clerk(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { ...H, Cookie: cookieStr() || undefined }, body: method === "GET" ? undefined : body.toString() })
  const b = await r.text()
  const j = (() => { try { return JSON.parse(b) } catch { return null } })()
  absorb(r)
  return { r, b, j }
}

// --- IMAP ---
function connect() {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host: IMAP.host, port: IMAP.port, rejectUnauthorized: false })
    sock.setEncoding("utf8")
    let lineBuf = "", active = null, grep = false, seq = 0
    sock.on("data", (d) => {
      lineBuf += d
      let idx
      while ((idx = lineBuf.indexOf("\r\n")) >= 0) {
        const line = lineBuf.slice(0, idx); lineBuf = lineBuf.slice(idx + 2)
        if (!grep && line.startsWith("* OK")) { grep = true; resolve({ sock, cmd }); continue }
        const m = line.match(/^(C\d+) (OK|NO|BAD)(?: \[([^\]]*)\])?\s?(.*)$/)
        if (active && m && m[1] === active.tag) { const a = active; active = null; a.res((a.data ? a.data + "\r\n" : "") + line) }
        else if (active) active.data += line + "\n"
      }
    })
    sock.on("error", reject)
    setTimeout(() => { if (!grep) reject(new Error("greet timeout")) }, 10000)
    function cmd(c) { return new Promise((res, rej) => { const tag = "C" + (++seq); active = { tag, data: "", res }; sock.write(tag + " " + c + "\r\n"); setTimeout(() => { if (active && active.tag === tag) { active = null; rej(new Error("cmd timeout")) } }, 30000) }) }
  })
}
const MN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const nD = new Date()
const since = String(nD.getDate()).padStart(2, "0") + "-" + MN[nD.getMonth()] + "-" + nD.getFullYear()
async function waitForCode(cmdFn, email, label) {
  let code = null
  const t0 = Date.now()
  while (Date.now() - t0 < 180000 && !code) {
    const so = await cmdFn("UID SEARCH SINCE " + since)
    const uids = (so.match(/SEARCH\s+([\d\s]+)/)?.[1] || "").trim().split(/\s+/).filter(Boolean)
    for (const uid of uids.slice(-8).reverse()) {
      const f = await cmdFn("UID FETCH " + uid + " (BODY.PEEK[HEADER.FIELDS (TO)] BODY.PEEK[TEXT])")
      const dec = f.replace(/=3D/g, "=").replace(/[0-9a-fA-F]{2}=/g, (m) => { const c = parseInt(m.slice(0, 2), 16); return (c >= 32 && c < 127) ? String.fromCharCode(c) : "?" })
      const to = (dec.match(/To[:(]\s*([^\r\n]+)/i) || [""])[0].trim()
      if (!to.includes(email)) continue
      const d2 = dec.match(/>(\d{6})</)
      if (d2) { code = d2[1] }
    }
    if (!code) { const el = Math.round((Date.now() - t0) / 1000); if (el % 30 < 7) console.log(label + " ..." + el + "s"); await new Promise(r2 => setTimeout(r2, 6000)) }
  }
  return code
}

const tt = Date.now().toString(36)
const email = "furia_" + tt + "@furia.ink"
const r1 = await clerk("POST", "/v1/client/sign_ups?" + QS, new URLSearchParams({ email_address: email, first_name: "Alex", last_name: "Cartel", password: "Furia_" + tt.slice(-3).toUpperCase() + "ab1!9", locale: "en-US" }))
const suaId = r1.j?.response?.id
console.log("1) sign_up=" + r1.r.status + " sua=" + suaId)
await clerk("POST", "/v1/client/sign_ups/" + suaId + "/prepare_verification?" + QS, new URLSearchParams({ strategy: "email_code" }))
const s = await connect()
console.log("2) IMAP LOGIN=" + ((await s.cmd("LOGIN " + JSON.stringify(IMAP.user) + " " + JSON.stringify(IMAP.pass))).match(/(OK|NO)[^\n]*/) ? "done" : "?"))
await s.cmd("SELECT INBOX")
const code = await waitForCode(s.cmd, email, "3) otp")
if (!code) { fs.writeFileSync("C:/Users/J0hnD03/AppData/Local/Temp/furia_e2e8.json", JSON.stringify({ ok: false, step: "otp", email }, null, 2)); console.log("NO CODE"); process.exit(1) }
console.log("3) CODE=" + code)
const r4 = await clerk("POST", "/v1/client/sign_ups/" + suaId + "/attempt_verification?" + QS, new URLSearchParams({ code, strategy: "email_code" }))
console.log("4) verify=" + r4.r.status + " status=" + r4.j?.response?.status + " missing=" + JSON.stringify(r4.j?.response?.missing_fields))
const r5 = await clerk("PATCH", "/v1/client/sign_ups/" + suaId + "/protect_check?" + QS, new URLSearchParams({ proof_token: PROOF }))
let j5 = null; try { j5 = JSON.parse(r5.b) } catch {}
const resp5 = j5?.response || {}
console.log("5) PATCH protect_check=" + r5.r.status + " | status=" + resp5.status + " missing=" + JSON.stringify(resp5.missing_fields))
console.log("   protect_check field: " + JSON.stringify(resp5.protect_check || null).slice(0, 400))
const r6 = await clerk("GET", "/v1/client/sign_ups/" + suaId + "?" + QS)
const resp6 = r6.j?.response || {}
console.log("6) GET sua: status=" + resp6.status + " missing=" + JSON.stringify(resp6.missing_fields))
const out = { browserless: true, email, suaId, ok: false, cid: cm[1], proofHead: PROOF.slice(0, 40), verify: r4.j?.response?.status, patch: { http: r5.r.status, status: resp5.status, missing: resp5.missing_fields, protect_check: resp5.protect_check || null }, getAfter: { suStatus: resp6.status, missing: resp6.missing_fields }, sec: Math.round((Date.now() - t_all) / 1000) }
const ct = ckMap.get("client_token")
if (ct) {
  out.clientToken = ct.slice(0, 60)
  const g = await fetch(BASE + "/v1/client?client_token=" + encodeURIComponent(ct) + "&" + QS, { headers: { "User-Agent": H["User-Agent"] } })
  const gj = await g.json().catch(() => null)
  out.clientGet = { http: g.status, session_id: gj?.response?.session_id || gj?.response?.sessions?.[0]?.id, user_id: gj?.response?.user_id }
  console.log("7) GET /v1/client=" + g.status + " session=" + out.clientGet.session_id + " user=" + out.clientGet.user_id)
}
if (resp6.status === "complete" || resp6.session_created_at != null || out.clientGet) out.ok = true
s.cmd("LOGOUT").catch(() => {}); s.sock.end()
fs.writeFileSync("C:/Users/J0hnD03/AppData/Local/Temp/furia_e2e8.json", JSON.stringify(out, null, 2))
console.log("SAVED furia_e2e8.json — BROWSERLESS OK=" + out.ok)
