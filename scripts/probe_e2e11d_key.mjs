// E2E #11d: повний цикл + браузер /keys з cookie на ДОМЕНІ cartesia.ai + XHR перехоп
import tls from "tls"
import fs from "fs"
import { chromium } from "playwright"
const BASE = "https://clerk.cartesia.ai"
const QS = "__clerk_api_version=2026-05-12&_clerk_js_version=6.30.1"
const H = { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36", Origin: "https://play.cartesia.ai", Referer: "https://play.cartesia.ai/sign-in/create" }
const IMAP = { host: "imap.gmail.com", port: 993, user: "nameofsewar@gmail.com", pass: "kvti mrvs iqmr wufe" }
const t_all = Date.now()

// ---- specter ----
let specter = null
const browser = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-gpu"] })
const page = await (await browser.newContext({ userAgent: H["User-Agent"] })).newPage()
page.setDefaultTimeout(60000)
for (let attempt = 1; attempt <= 4 && !specter; attempt++) {
  try {
    await page.goto("https://play.cartesia.ai/sign-in/create", { waitUntil: "domcontentloaded", timeout: 60000 })
    for (let i = 0; i < 30; i++) { await page.waitForTimeout(1500); const ti = await page.title(); if (!/checkpoint/i.test(ti)) break }
    for (let i = 0; i < 60 && !(await page.evaluate(() => !!window.__clerk_specter)); i++) await page.waitForTimeout(500)
    if (!await page.evaluate(() => !!window.__clerk_specter)) throw new Error("no specter")
    specter = await page.evaluate(async () => {
      const s = window.__clerk_specter
      const rd = await Promise.race([Promise.resolve(s.ready).catch(() => null), new Promise(r => setTimeout(r, 15000))])
      return { cid: s.cid, token: rd && rd.token }
    })
  } catch (e2) { console.log("specter attempt " + attempt + ": " + (e2 && e2.message).slice(0, 120)); await new Promise(r2 => setTimeout(r2, 5000)) }
}
await browser.close()
if (!specter || !specter.token) { console.log("NO SPECTER TOKEN"); process.exit(1) }
console.log("0) specter ok")

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
async function charon(protectCheck) {
  const verify = new URL("v1/verify", new URL(protectCheck.sdk_url))
  verify.searchParams.set("challenge", protectCheck.token)
  const reqUp = Math.max(0, parseInt((protectCheck.ui_hints || {}).required_upload, 10) || 0)
  const vres = await fetch(verify.href, { method: "POST", headers: { "content-type": "application/octet-stream", authorization: "Bearer " + protectCheck.ui_hints.authz }, body: new Uint8Array(reqUp) })
  if (!vres.ok) throw new Error("charon verify " + vres.status)
  const { proof_token: pot } = await vres.json()
  if (!pot) throw new Error("no pot")
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
const r1 = await clerk("POST", "/v1/client/sign_ups?" + QS, new URLSearchParams({ email_address: email, first_name: "Alex", last_name: "Cartel", password: "Furia_" + tt.slice(-3).toUpperCase() + "ab1!9", locale: "en-US" }))
console.log("1) sign_up=" + r1.r.status)
const rawCookies = (r1.r.headers.getSetCookie ? r1.r.headers.getSetCookie() : []).map(c => (c.match(/^(__client)[=][^;]+( [^;]+)?/i) || [c])[0].split(";").slice(0, 5).join(";").slice(0, 160))
console.log("   raw set-cookie attrs:\n   " + rawCookies.join("\n   "))
const suaId = r1.j?.response?.id
await clerk("POST", "/v1/client/sign_ups/" + suaId + "/prepare_verification?" + QS, new URLSearchParams({ strategy: "email_code" }))
const s = await connect()
await s.cmd("LOGIN " + JSON.stringify(IMAP.user) + " " + JSON.stringify(IMAP.pass))
await s.cmd("SELECT INBOX")
const code = await waitForCode(s.cmd, email, "2) otp")
await clerk("POST", "/v1/client/sign_ups/" + suaId + "/attempt_verification?" + QS, new URLSearchParams({ code, strategy: "email_code" }))
const r5 = await clerk("PATCH", "/v1/client/sign_ups/" + suaId + "/protect_check?" + QS, new URLSearchParams({ proof_token: specter.token }))
const pot = await charon(r5.j?.response?.protect_check)
const r7 = await clerk("PATCH", "/v1/client/sign_ups/" + suaId + "/protect_check?" + QS, new URLSearchParams({ proof_token: pot }))
console.log("3) complete=" + (r7.j?.response?.status === "complete"))
s.cmd("LOGOUT").catch(() => {}); s.sock.end()

// ---- браузер /keys, cookie на cartesia.ai ----
const cj = ckMap.get("__client")
const b2 = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-gpu"] })
const ctx2 = await b2.newContext({ userAgent: H["User-Agent"] })
await ctx2.addCookies([
  { name: "__client", value: cj, domain: ".cartesia.ai", path: "/" },
])
const p2 = await ctx2.newPage()
p2.setDefaultTimeout(120000)
const captured = []
p2.on("requestfinished", (req) => {
  const u = req.url()
  const res = req.response()
  if (!res) return
  if (req.method() === "GET" && /\.(js|css|png|woff2?|ico|svg|map)/.test(u)) return
  if (/datadoghq|gstatic|gravatar|clerk\.com\/ins|prot\.clerk|mp\/track|auth\/cartesia/.test(u)) return
  rec: {
    const st = typeof res.status === "function" ? res.status() : res.status
    let body = ""
    Promise.resolve().then(() => res.text()).then(b => { body = b; if (b && /sk_car_|api_keys|client/.test(b.slice(0, 500))) { const rec = { method: req.method(), status: st, url: u.slice(0, 220), reqBody: (req.postData() || "").slice(0, 500), respBody: b.slice(0, 1200) }; if (!captured.some(x => x.url === rec.url && x.method === rec.method && x.reqBody === rec.reqBody)) captured.push(rec); console.log("[KEY-XHR] " + rec.method + " " + st + " " + u.slice(0, 150)); console.log("   req: " + rec.reqBody.slice(0, 200)); console.log("   resp: " + rec.respBody.slice(0, 400)) } }).catch(() => {})
  }
})
await p2.goto("https://play.cartesia.ai/keys", { waitUntil: "domcontentloaded", timeout: 120000 })
for (let i = 0; i < 40; i++) { await p2.waitForTimeout(1500); const t = await p2.title().catch(() => ""); if (!/checkpoint/i.test(t)) break }
console.log("4) title=" + await p2.title())
await p2.waitForTimeout(5000)
const txt = await p2.evaluate(() => (document.body.innerText || "").slice(0, 500))
console.log("4b) page: " + txt.replace(/\n/g, " | ").slice(0, 350))
if (/sign ?in|email address/i.test(txt)) { console.log("4c) РЕДІРЕКТ НА SIGN-IN — cookie domain не спрацювали"); await b2.close(); process.exit(2) }
const btn = await p2.$('button:has-text("Create API key")')
if (btn) { await btn.click(); console.log("5) clicked"); await p2.waitForTimeout(2000) }
else console.log("5) NO create btn. buttons: " + JSON.stringify(await p2.$$eval("button", bs => bs.map(b => (b.textContent || "").trim()).filter(Boolean).slice(0, 12))))
const nameInput = await p2.$("input")
if (nameInput) { await nameInput.type("Furia Key", { delay: 20 }); console.log("5b) typed name") }
await p2.waitForTimeout(400)
await p2.keyboard.press("Enter")
console.log("5c) Enter")
await p2.waitForTimeout(6000)
const finalTxt = await p2.evaluate(() => (document.body.innerText || "").slice(0, 1500))
console.log("6) final: " + finalTxt.replace(/\n/g, " | ").slice(0, 700))
const skm = finalTxt.match(/sk_car_[A-Za-z0-9_-]{8,}/)
console.log("6b) sk_car_ in text: " + (skm ? skm[0].slice(0, 20) + "..." : "no"))
await b2.close()
fs.writeFileSync("C:/Users/J0hnD03/AppData/Local/Temp/furia_key_xhr.json", JSON.stringify({ email, captured, finalText: finalTxt.slice(0, 2000), sk: skm ? skm[0] : null }, null, 2))
console.log("SAVED furia_key_xhr.json — " + Math.round((Date.now() - t_all) / 1000) + "s")
