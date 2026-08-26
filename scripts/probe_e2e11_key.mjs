// E2E #11: повний цикл + перехоплення XHR створення API key на /keys
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
      return { cid: s.cid, token: rd && rd.token, exp: rd && rd.exp }
    })
  } catch (e2) { console.log("specter attempt " + attempt + ": " + (e2 && e2.message).slice(0, 120)); await new Promise(r2 => setTimeout(r2, 5000)) }
}
await browser.close()
if (!specter || !specter.token) { console.log("NO SPECTER TOKEN"); process.exit(1) }
console.log("0) specter ok")

// ---- clerk ----
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

// ---- повний цикл ----
const tt = Date.now().toString(36)
const email = "furia_" + tt + "@furia.ink"
const r1 = await clerk("POST", "/v1/client/sign_ups?" + QS, new URLSearchParams({ email_address: email, first_name: "Alex", last_name: "Cartel", password: "Furia_" + tt.slice(-3).toUpperCase() + "ab1!9", locale: "en-US" }))
const suaId = r1.j?.response?.id
console.log("1) sign_up=" + r1.r.status + " sua=" + suaId)
await clerk("POST", "/v1/client/sign_ups/" + suaId + "/prepare_verification?" + QS, new URLSearchParams({ strategy: "email_code" }))
const s = await connect()
await s.cmd("LOGIN " + JSON.stringify(IMAP.user) + " " + JSON.stringify(IMAP.pass))
await s.cmd("SELECT INBOX")
const code = await waitForCode(s.cmd, email, "2) otp")
await clerk("POST", "/v1/client/sign_ups/" + suaId + "/attempt_verification?" + QS, new URLSearchParams({ code, strategy: "email_code" }))
const r5 = await clerk("PATCH", "/v1/client/sign_ups/" + suaId + "/protect_check?" + QS, new URLSearchParams({ proof_token: specter.token }))
const pc = r5.j?.response?.protect_check
console.log("3) cha=" + (pc ? pc.status : "MISSING"))
const pot = await charon(pc)
const r7 = await clerk("PATCH", "/v1/client/sign_ups/" + suaId + "/protect_check?" + QS, new URLSearchParams({ proof_token: pot }))
const resp7 = r7.j?.response || {}
console.log("4) complete=" + (resp7.status === "complete"))
const r8 = await clerk("GET", "/v1/client?" + QS)
const client = r8.j?.response
const sesId = client?.sessions?.[0]?.id
const jwt = client?.sessions?.[0]?.last_active_token?.jwt
console.log("5) session=" + sesId, "jwt=" + (jwt ? "yes " + jwt.length + " chars" : "NO"))
s.cmd("LOGOUT").catch(() => {}); s.sock.end()
fs.writeFileSync("C:/Users/J0hnD03/AppData/Local/Temp/furia_e2e11_session.json", JSON.stringify({ email, suaId, sesId, jwt, clientCookie: ckMap.get("__client") }, null, 2))

// ---- браузер з __client cookie: /keys + перехоп XHR ----
const cj = ckMap.get("__client")
const b2 = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-gpu"] })
const ctx2 = await b2.newContext({ userAgent: H["User-Agent"] })
await ctx2.addCookies([{ name: "__client", value: cj, domain: "play.cartesia.ai", path: "/" }, { name: "__client_uat", value: ckMap.get("__client_uat") || "0", domain: "play.cartesia.ai", path: "/" }])
const p2 = await ctx2.newPage()
p2.setDefaultTimeout(90000)
const captured = []
p2.on("requestfinished", async (req) => {
  const u = req.url()
  const res = req.response()
  if (!res) return
  if (/clerk\.cartesia|cdn\.|fonts|google|gravatar|images/.test(u)) return
  if (req.method() === "GET" && /\.(js|css|png|woff|ico|svg)/.test(u)) return
  let body = ""
  try { body = await res.text() } catch {}
  captured.push({ method: req.method(), url: u.slice(0, 200), status: res.status(), reqBody: (req.postData() || "").slice(0, 300), respBody: body.slice(0, 700) })
  console.log("[XHR] " + req.method() + " " + res.status() + " " + u.slice(0, 130))
})
try {
  await p2.goto("https://play.cartesia.ai/keys", { waitUntil: "domcontentloaded", timeout: 90000 })
  for (let i = 0; i < 30; i++) { await p2.waitForTimeout(1500); const t = await p2.title(); if (!/checkpoint/i.test(t)) break }
  console.log("6) /keys title=" + await p2.title())
  // чекаємо гідратацію: будь-який XHR закінчився АБО текст сторінки зміст
  for (let i = 0; i < 40; i++) { await p2.waitForTimeout(1000); const hasUi = await p2.evaluate(() => /api key/i.test(document.body.innerText || "")); if (hasUi) break }
  const bodyText = await p2.evaluate(() => (document.body.innerText || "").slice(0, 400))
  console.log("6b) page text: " + bodyText.replace(/\n/g, " | ").slice(0, 300))
  // натискаємо Create API key
  const btn = await p2.$('button:has-text("Create API key"), button:has-text("Create key"), [class*=create]')
  if (btn) { await btn.click(); console.log("7) clicked create"); await p2.waitForTimeout(1500) }
  else console.log("7) NO create button — buttons: " + (await p2.$$eval("button", bs => bs.map(b => (b.textContent || "").trim()).filter(Boolean).slice(0, 10)).join(" | ")))
  // відкрившийся модал: заповнюємо назву якщо треба, сабмітим Enter
  await p2.waitForTimeout(1000)
  const inputs = await p2.$$eval("input", els => els.map(e => ({ ph: e.placeholder, val: e.value, type: e.type })).slice(0, 8))
  console.log("7b) inputs: " + JSON.stringify(inputs).slice(0, 300))
  const nameInput = await p2.$("input")
  if (nameInput) {
    const ph = await nameInput.getAttribute("placeholder") || ""
    if (/name/i.test(ph || "")) { await nameInput.type("Furia Key"); console.log("7c) typed name") }
  }
  await p2.keyboard.press("Enter")
  await p2.waitForTimeout(4000)
  await p2.keyboard.press("Enter")
  await p2.waitForTimeout(4000)
  const finalText = await p2.evaluate(() => (document.body.innerText || "").slice(0, 800))
  console.log("8) final text: " + finalText.replace(/\n/g, " | ").slice(0, 400))
} catch (e) { console.log("keys page err: " + (e && e.message).slice(0, 200)) }
await b2.close()
fs.writeFileSync("C:/Users/J0hnD03/AppData/Local/Temp/furia_e2e11_xhr.json", JSON.stringify({ captured: captured.slice(-25) }, null, 2))
console.log("SAVED furia_e2e11_xhr.json — total " + Math.round((Date.now() - t_all) / 1000) + "s")
