// E2E #10: повний цикл + повний дамп post-complete: відповідь PATCH, cookie jar, GET /v1/client, /v1/me, /v1/sessions
import tls from "tls"
import fs from "fs"
import { chromium } from "playwright"
const BASE = "https://clerk.cartesia.ai"
const QS = "__clerk_api_version=2026-05-12&_clerk_js_version=6.30.1"
const H = { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36", Origin: "https://play.cartesia.ai", Referer: "https://play.cartesia.ai/sign-in/create" }
const IMAP = { host: "imap.gmail.com", port: 993, user: "nameofsewar@gmail.com", pass: "kvti mrvs iqmr wufe" }
const t_all = Date.now()

// --- 0) specter ---
let specter = null
const browser = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-gpu"] })
const page = await (await browser.newContext({ userAgent: H["User-Agent"] })).newPage()
page.setDefaultTimeout(60000)
for (let attempt = 1; attempt <= 4 && !specter; attempt++) {
  try {
    await page.goto("https://play.cartesia.ai/sign-in/create", { waitUntil: "domcontentloaded", timeout: 60000 })
    for (let i = 0; i < 30; i++) { await page.waitForTimeout(1500); const ti = await page.title(); if (!/checkpoint/i.test(ti)) break }
    for (let i = 0; i < 60 && !(await page.evaluate(() => !!window.__clerk_specter)); i++) await page.waitForTimeout(500)
    if (!await page.evaluate(() => !!window.__clerk_specter)) throw new Error("no __clerk_specter")
    specter = await page.evaluate(async () => {
      const s = window.__clerk_specter
      const rd = await Promise.race([Promise.resolve(s.ready).catch(() => null), new Promise(r => setTimeout(r, 15000))])
      return { cid: s.cid, token: rd && rd.token, exp: rd && rd.exp }
    })
  } catch (e2) { console.log("specter attempt " + attempt + ": " + (e2 && e2.message).slice(0, 120)); await new Promise(r2 => setTimeout(r2, 5000)) }
}
await browser.close()
if (!specter || !specter.token) { console.log("NO SPECTER TOKEN"); process.exit(1) }
console.log("0) specter cid=" + specter.cid)

const ckMap = new Map()
function absorb(r, tag) { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const p = c.split(";")[0]; const i = p.indexOf("="); if (i > 0) { if (!ckMap.has(p.slice(0, i))) console.log("  ck+[" + tag + "] " + p.slice(0, i)); ckMap.set(p.slice(0, i), p.slice(i + 1)) } } }
const cookieStr = () => [...ckMap.entries()].map(([k, v]) => k + "=" + v).join("; ")
async function clerk(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { ...H, Cookie: cookieStr() || undefined }, body: method === "GET" ? undefined : body.toString() })
  const b = await r.text()
  const j = (() => { try { return JSON.parse(b) } catch { return null } })()
  absorb(r, method + path.split("/").slice(-2).join("/"))
  return { r, b, j }
}

async function charon(protectCheck) {
  const cha = protectCheck.token
  const bearer = protectCheck.ui_hints.authz
  const sdkUrl = new URL(protectCheck.sdk_url)
  const reqUp = Math.max(0, parseInt((protectCheck.ui_hints || {}).required_upload, 10) || 0)
  const verify = new URL("v1/verify", sdkUrl)
  verify.searchParams.set("challenge", cha)
  const vres = await fetch(verify.href, { method: "POST", headers: { "content-type": "application/octet-stream", authorization: "Bearer " + bearer }, body: new Uint8Array(reqUp) })
  if (!vres.ok) throw new Error("charon verify " + vres.status + " " + (await vres.text()).slice(0, 150))
  const { proof_token: pot } = await vres.json()
  if (!pot) throw new Error("no pot token")
  return pot
}

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
const MN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
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
      if (d2) code = d2[1]
    }
    if (!code) { const el = Math.round((Date.now() - t0) / 1000); if (el % 30 < 7) console.log(label + " ..." + el + "s"); await new Promise(r2 => setTimeout(r2, 6000)) }
  }
  return code
}

const tt = Date.now().toString(36)
const email = "furia_" + tt + "@furia.ink"
console.log("1) email=" + email)
const r1 = await clerk("POST", "/v1/client/sign_ups?" + QS, new URLSearchParams({ email_address: email, first_name: "Alex", last_name: "Cartel", password: "Furia_" + tt.slice(-3).toUpperCase() + "ab1!9", locale: "en-US" }))
const suaId = r1.j?.response?.id
console.log("1) sign_up=" + r1.r.status + " sua=" + suaId)
await clerk("POST", "/v1/client/sign_ups/" + suaId + "/prepare_verification?" + QS, new URLSearchParams({ strategy: "email_code" }))
const s = await connect()
await s.cmd("LOGIN " + JSON.stringify(IMAP.user) + " " + JSON.stringify(IMAP.pass))
await s.cmd("SELECT INBOX")
const code = await waitForCode(s.cmd, email, "2) otp")
console.log("2) CODE=" + code)
await clerk("POST", "/v1/client/sign_ups/" + suaId + "/attempt_verification?" + QS, new URLSearchParams({ code, strategy: "email_code" }))
const r5 = await clerk("PATCH", "/v1/client/sign_ups/" + suaId + "/protect_check?" + QS, new URLSearchParams({ proof_token: specter.token }))
const pc = r5.j?.response?.protect_check
if (!pc || pc.status !== "pending") { console.log("NO CHA: " + JSON.stringify(pc || {}).slice(0, 300) + " status=" + r5.j?.response?.status); process.exit(1) }
console.log("3) cha ok, running charon...")
const pot = await charon(pc)
console.log("4) pot=" + pot.slice(0, 30) + "...")
const r7 = await clerk("PATCH", "/v1/client/sign_ups/" + suaId + "/protect_check?" + QS, new URLSearchParams({ proof_token: pot }))
console.log("5) FINAL PATCH " + r7.r.status)
console.log("=== FULL FINAL RESP ===")
console.log(r7.b.slice(0, 3000))
console.log("=== COOKIE JAR ===")
for (const [k, v] of ckMap.entries()) console.log("  " + k + " = " + v.slice(0, 80) + (v.length > 80 ? "..." : ""))
// --- post-complete session extraction ---
const r8 = await clerk("GET", "/v1/client?" + QS)
console.log("6) GET /v1/client=" + r8.r.status, "body len=" + r8.b.length)
console.log(r8.b.slice(0, 4000))
const client = r8.j?.response
const sesId = client?.session_id || (client?.sessions && client.sessions[0] && client.sessions[0].id)
console.log("6b) client.session_id=" + sesId, "signups=" + JSON.stringify((client?.sign_ups || []).map(x => ({ id: x.id, status: x.status }))))
if (sesId) {
  const r9 = await clerk("GET", "/v1/sessions/" + sesId + "?" + QS)
  console.log("7) GET /v1/sessions/<id>=" + r9.r.status)
  console.log(r9.b.slice(0, 2500))
  const r10 = await clerk("GET", "/v1/me/" + sesId + "?" + QS)
  console.log("8) GET /v1/me/<id>=" + r10.r.status, r10.b.slice(0, 400))
}
s.cmd("LOGOUT").catch(() => {}); s.sock.end()
fs.writeFileSync("C:/Users/J0hnD03/AppData/Local/Temp/furia_e2e10.json", JSON.stringify({ email, suaId, sec: Math.round((Date.now() - t_all) / 1000), finalResp: r7.j, cookieJar: Object.fromEntries([...ckMap.entries()].map(([k, v]) => [k, v.slice(0, 120)])), clientGet: r8.j, sesId }, null, 2))
console.log("SAVED furia_e2e10.json — total " + Math.round((Date.now() - t_all) / 1000) + "s")
