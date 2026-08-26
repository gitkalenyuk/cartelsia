// E2E #9: ПОВНИЙ 4-СТАПЕВИЙ цикл без браузера (крім спект-токену):
// sign_up -> prepare -> OTP/verify -> PATCH(spc) -> charon verify (64KB upload) -> PATCH(pot) -> complete
import tls from "tls"
import fs from "fs"
import { chromium } from "playwright"
const BASE = "https://clerk.cartesia.ai"
const QS = "__clerk_api_version=2026-05-12&_clerk_js_version=6.30.1"
const H = { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36", Origin: "https://play.cartesia.ai", Referer: "https://play.cartesia.ai/sign-in/create" }
const IMAP = { host: "imap.gmail.com", port: 993, user: "nameofsewar@gmail.com", pass: "kvti mrvs iqmr wufe" }
const t_all = Date.now()

// --- 0) specter spc token (browser, Vercel checkpoint retry) ---
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
console.log("0) specter cid=" + specter.cid, "exp_h=" + ((specter.exp - Date.now() / 1000) / 3600).toFixed(1))

// --- clerk + cookies ---
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

// --- charon proof-of-transfer ---
async function charon(protectCheck) {
  const cha = protectCheck.token
  const bearer = protectCheck.ui_hints.authz
  const sdkUrl = new URL(protectCheck.sdk_url)
  const hints = protectCheck.ui_hints || {}
  const reqUp = Math.max(0, parseInt(hints.required_upload, 10) || 0)
  const reqDown = Math.max(0, parseInt(hints.required_download, 10) || 0)
  let downloadProof = ""
  if (reqDown > 0) {
    const pull = new URL("v1/pull", sdkUrl)
    let cont = null, offset = 0, rolling = null
    for (;;) {
      const url = new URL(pull)
      if (cont === null) url.searchParams.set("challenge", cha)
      else { url.searchParams.set("cont", cont); url.searchParams.set("offset", String(offset)); url.searchParams.set("hash", rolling) }
      const res = await fetch(url.href, { headers: { authorization: "Bearer " + bearer } })
      if (!res.ok) throw new Error("charon pull " + res.status)
      const chunk = new Uint8Array(await res.arrayBuffer())
      cont = res.headers.get("x-clerk-pot-continuation")
      if (!cont) throw new Error("no continuation")
      if (rolling === null) rolling = res.headers.get("x-clerk-pot-seed")
      if (res.headers.get("x-clerk-pot-complete") === "1") { downloadProof = cont; break }
      // rolling sha-256
      const prev = Buffer.from(rolling, "hex")
      rolling = crypto.subtle ? (Buffer.from(await (await import("crypto")).webcrypto.subtle.digest("SHA-256", new Uint8Array([...prev, ...chunk]))).hex) : null
      offset += chunk.length
    }
  }
  const verify = new URL("v1/verify", sdkUrl)
  verify.searchParams.set("challenge", cha)
  if (downloadProof) verify.searchParams.set("download_proof", downloadProof)
  const vres = await fetch(verify.href, {
    method: "POST",
    headers: { "content-type": "application/octet-stream", authorization: "Bearer " + bearer },
    body: new Uint8Array(reqUp),
  })
  if (!vres.ok) { const t2 = await vres.text(); throw new Error("charon verify " + vres.status + " " + t2.slice(0, 200)) }
  const { proof_token: pot } = await vres.json()
  if (!pot) throw new Error("no pot token")
  return { pot, reqUp, reqDown }
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

async function fullFlow(tag) {
  const tt = Date.now().toString(36)
  const email = "furia_" + tt + "@furia.ink"
  const s0 = Date.now()
  const r1 = await clerk("POST", "/v1/client/sign_ups?" + QS, new URLSearchParams({ email_address: email, first_name: "Alex", last_name: "Cartel", password: "Furia_" + tt.slice(-3).toUpperCase() + "ab1!9", locale: "en-US" }))
  const suaId = r1.j?.response?.id
  console.log(tag + " [1] sign_up=" + r1.r.status + " sua=" + suaId)
  if (!suaId) return { email, ok: false, step: "sign_up", body: r1.b.slice(0, 250) }
  await clerk("POST", "/v1/client/sign_ups/" + suaId + "/prepare_verification?" + QS, new URLSearchParams({ strategy: "email_code" }))
  const s = await connect()
  const lo = await s.cmd("LOGIN " + JSON.stringify(IMAP.user) + " " + JSON.stringify(IMAP.pass))
  if (!lo.includes("OK")) { console.log(tag + " IMAP FAIL " + lo.slice(-80)); return { email, ok: false, step: "imap" } }
  console.log(tag + " [2] IMAP ok, waiting OTP")
  await s.cmd("SELECT INBOX")
  const code = await waitForCode(s.cmd, email, tag + " otp")
  if (!code) { return { email, ok: false, step: "otp" } }
  const r4 = await clerk("POST", "/v1/client/sign_ups/" + suaId + "/attempt_verification?" + QS, new URLSearchParams({ code, strategy: "email_code" }))
  console.log(tag + " [3] verify=" + r4.r.status + " status=" + r4.j?.response?.status)
  // [4] spc -> cha
  const r5 = await clerk("PATCH", "/v1/client/sign_ups/" + suaId + "/protect_check?" + QS, new URLSearchParams({ proof_token: specter.token }))
  const pc = r5.j?.response?.protect_check
  if (!pc || pc.status === "complete") { console.log(tag + " [4] spc -> " + (pc ? pc.status : r5.r.status) + " (без cha?)"); if (r5.j?.response?.status === "complete") return { email, ok: true, via: "spc-only", suaId } }
  console.log(tag + " [4] cha status=" + pc.status + " up=" + (pc.ui_hints?.required_upload) + " down=" + (pc.ui_hints?.required_download))
  // [5] charon verify -> pot
  let pot
  try { pot = (await charon(pc)).pot } catch (e) { console.log(tag + " [5] charon FAIL: " + e.message); return { email, ok: false, step: "charon", err: e.message } }
  console.log(tag + " [5] pot=" + pot.slice(0, 24) + "...")
  // [6] pot -> complete
  const r7 = await clerk("PATCH", "/v1/client/sign_ups/" + suaId + "/protect_check?" + QS, new URLSearchParams({ proof_token: pot }))
  const resp7 = r7.j?.response || {}
  console.log(tag + " [6] PATCH pot=" + r7.r.status + " status=" + resp7.status + " missing=" + JSON.stringify(resp7.missing_fields) + " session_at=" + (resp7.session_created_at != null))
  if (r7.r.status !== 200 || !r7.j) return { email, ok: false, step: "pot_patch", body: r7.b.slice(0, 300) }
  const out = { email, suaId, ok: false, patchPotStatus: r7.r.status, suStatus: resp7.status, sec: Math.round((Date.now() - s0) / 1000) }
  const ct = ckMap.get("client_token")
  if (ct) {
    out.clientToken = ct.slice(0, 60)
    const g = await fetch(BASE + "/v1/client?client_token=" + encodeURIComponent(ct) + "&" + QS, { headers: { "User-Agent": H["User-Agent"] } })
    const gj = await g.json().catch(() => null)
    const sess = gj?.response?.session_id || gj?.response?.sessions?.[0]?.id
    out.clientGet = { http: g.status, session_id: sess, user_id: gj?.response?.user_id, clientStatus: gj?.response?.status }
    out.ok = !!(sess && gj?.response?.user_id)
    console.log(tag + " [7] /v1/client=" + g.status + " session=" + sess + " user=" + gj?.response?.user_id)
  }
  s.cmd("LOGOUT").catch(() => {}); s.sock.end()
  return out
}

console.log("=== FLOW #1 ===")
const f1 = await fullFlow("F1")
console.log("=== FLOW #2 (reuse спц-токен) ===")
ckMap.clear()
const f2 = await fullFlow("F2")

const res = { totalSec: Math.round((Date.now() - t_all) / 1000), specter: { cid: specter.cid, exp_h: +((specter.exp - Date.now() / 1000) / 3600).toFixed(2) }, flow1: f1, flow2: f2 }
fs.writeFileSync("C:/Users/J0hnD03/AppData/Local/Temp/furia_e2e9.json", JSON.stringify(res, null, 2))
console.log("SAVED furia_e2e9.json")
console.log("RESULT F1: " + JSON.stringify({ ok: f1.ok, step: f1.step, suStatus: f1.suStatus, session: f1.clientGet?.session_id }))
console.log("RESULT F2: " + JSON.stringify({ ok: f2.ok, step: f2.step, suStatus: f2.suStatus, session: f2.clientGet?.session_id }))
console.log("E2E9 DONE in " + Math.round((Date.now() - t_all) / 1000) + "s")
