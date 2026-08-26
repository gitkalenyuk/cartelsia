// E2E #6: повний browserless-цикл з PATCH protect_check (замість attempt_completion)
// 0) Playwright: завантажує сторінку, бере window.__clerk_specter (cid + ready -> {token,exp})
// 1) API: sign_up -> prepare -> IMAP OTP -> attempt_verification -> PATCH protect_check (proof_token)
// 2) повторний signup ТИМ САМИМ proof_token (тест reuse для N-потоків)
import tls from "tls"
import fs from "fs"
import { chromium } from "playwright"
const BASE = "https://clerk.cartesia.ai"
const QS = "__clerk_api_version=2026-05-12&_clerk_js_version=6.30.1"
const H = { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36", Origin: "https://play.cartesia.ai", Referer: "https://play.cartesia.ai/sign-in/create" }
const IMAP = { host: "imap.gmail.com", port: 993, user: "nameofsewar@gmail.com", pass: "kvti mrvs iqmr wufe" }
const t_all = Date.now()

// --- 0) specter proof token з браузера (з retry на Vercel checkpoint) ---
let specter = null
const browser = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-gpu"] })
const page = await (await browser.newContext({ userAgent: H["User-Agent"] })).newPage()
page.setDefaultTimeout(60000)
for (let attempt = 1; attempt <= 4 && !specter; attempt++) {
  try {
    await page.goto("https://play.cartesia.ai/sign-in/create", { waitUntil: "domcontentloaded", timeout: 60000 })
    for (let i = 0; i < 30; i++) { await page.waitForTimeout(1500); const ti = await page.title(); if (!/checkpoint/i.test(ti)) break }
    specter = await page.evaluate(async () => {
      for (let i = 0; i < 40 && !window.__clerk_specter; i++) await new Promise(r => setTimeout(r, 500))
      const s = window.__clerk_specter
      if (!s) return null
      const rd = await Promise.race([Promise.resolve(s.ready).catch(() => null), new Promise(r => setTimeout(r, 25000))])
      return { cid: s && s.cid, id: s && s.id, rd }
    })
    if (!specter) throw new Error("no __clerk_specter (title=" + (await page.title()).slice(0, 60) + ")")
  } catch (e2) {
    console.log("browser attempt " + attempt + " failed:", (e2 && e2.message || "").slice(0, 160))
    await new Promise(r2 => setTimeout(r2, 6000))
  }
}
await browser.close()
if (!specter || !specter.rd || !specter.rd.token) { console.log("NO SPECTER TOKEN:", JSON.stringify(specter).slice(0, 300)); process.exit(1) }
const PROOF = specter.rd.token
console.log("0) specter cid=" + specter.cid, "token=" + PROOF.slice(0, 40) + "...", "exp=" + specter.rd.exp, "ttl_h=" + ((specter.rd.exp - Date.now() / 1000) / 3600).toFixed(1))

// --- cookie + clerk helpers ---
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
        else if (active) active.data += line + "\r\n"
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
    for (const uid of uids.slice(-6).reverse()) {
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

async function fullFlow(tag) {
  const tt = Date.now().toString(36)
  const email = "furia_" + tt + "@furia.ink"
  const s0 = Date.now()
  const r1 = await clerk("POST", "/v1/client/sign_ups?" + QS, new URLSearchParams({ email_address: email, first_name: "Alex", last_name: "Cartel", password: "Furia_" + tt.slice(-3).toUpperCase() + "ab1!9", locale: "en-US" }))
  const suaId = r1.j?.response?.id
  console.log(tag + " sign_up=" + r1.r.status + " sua=" + suaId)
  if (!suaId) return { email, ok: false, step: "sign_up", body: r1.b.slice(0, 300) }
  await clerk("POST", "/v1/client/sign_ups/" + suaId + "/prepare_verification?" + QS, new URLSearchParams({ strategy: "email_code" }))
  const s = await connect()
  const lo = await s.cmd("LOGIN " + JSON.stringify(IMAP.user) + " " + JSON.stringify(IMAP.pass))
  if (!/ OK /.test(lo)) { console.log(tag + " IMAP LOGIN FAILED"); return { email, ok: false, step: "imap" } }
  await s.cmd("SELECT INBOX")
  const code = await waitForCode(s.cmd, email, tag + " otp")
  if (!code) { console.log(tag + " NO CODE"); return { email, ok: false, step: "otp" } }
  console.log(tag + " CODE=" + code)
  const r4 = await clerk("POST", "/v1/client/sign_ups/" + suaId + "/attempt_verification?" + QS, new URLSearchParams({ code, strategy: "email_code" }))
  console.log(tag + " verify=" + r4.r.status + " status=" + r4.j?.response?.status + " missing=" + JSON.stringify(r4.j?.response?.missing_fields))
  const r5 = await clerk("PATCH", "/v1/client/sign_ups/" + suaId + "/protect_check?" + QS, new URLSearchParams({ proof_token: PROOF }))
  let j5 = null; try { j5 = JSON.parse(r5.b) } catch {}
  console.log(tag + " PATCH protect_check=" + r5.r.status + " | ct=" + r5.r.headers.get("content-type") + " | server=" + r5.r.headers.get("server"))
  console.log(tag + "   body: " + r5.b.slice(0, 400))
  const sess = j5?.response
  const out = { email, suaId, ok: !!(j5 && sess), verifyStatus: r4.j?.response?.status, patchStatus: r5.r.status, patchBody: r5.b.slice(0, 1200), sec: Math.round((Date.now() - s0) / 1000), cookies: r5.headers.getSetCookie ? r5.headers.getSetCookie().map(c => c.split(";")[0]) : [] }
  if (sess) {
    out.finalStatus = sess.status
    const ct = out.cookies.find(c => c.startsWith("client_token="))
    if (ct) {
      out.clientToken = ct.split("=").slice(1).join("=")
      const g = await fetch(BASE + "/v1/client?client_token=" + encodeURIComponent(out.clientToken) + "&" + QS, { headers: { "User-Agent": H["User-Agent"] } })
      const gj = await g.json().catch(() => null)
      out.clientGet = { http: g.status, session_id: gj?.response?.session_id, user_id: gj?.response?.user_id, clientStatus: gj?.response?.status }
      console.log(tag + " GET /v1/client=" + g.status + " session=" + gj?.response?.session_id + " user=" + gj?.response?.user_id)
    }
  }
  s.cmd("LOGOUT").catch(() => {}); s.sock.end()
  return out
}

console.log("=== FLOW #1 (новий proof token) ===")
const f1 = await fullFlow("F1")
console.log("=== FLOW #2 (ТОЙ САМИЙ proof token — reuse test) ===")
ckMap.clear()
const f2 = await fullFlow("F2")

fs.writeFileSync("C:/Users/J0hnD03/AppData/Local/Temp/furia_e2e6.json", JSON.stringify({ totalSec: Math.round((Date.now() - t_all) / 1000), specter: { cid: specter.cid, id: specter.id, tokenHead: PROOF.slice(0, 60), exp: specter.rd.exp }, flow1: f1, flow2: f2 }, null, 2))
console.log("SAVED furia_e2e6.json")
console.log("E2E6 DONE in " + Math.round((Date.now() - t_all) / 1000) + "s")