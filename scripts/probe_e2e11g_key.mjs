// E2E #11g: повний цикл + /keys + ШИРОКИЙ XHR лог + ключ з input-ів в діалозі "Your new API key"
import tls from "tls"
import fs from "fs"
import { chromium } from "playwright"
const BASE = "https://clerk.cartesia.ai"
const QS = "__clerk_api_version=2026-05-12&_clerk_js_version=6.30.1"
const H = { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/0.0 -UA-PLACE-", Origin: "https://play.cartesia.ai", Referer: "https://play.cartesia.ai/sign-in/create" }
H["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
const IMAP = { host: "imap.gmail.com", port: 993, user: "nameofsewar@gmail.com", pass: "kvti mrvs iqmr wufe" }
const t_all = Date.now()

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

const cj = ckMap.get("__client")
const b2 = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-gpu"] })
const ctx2 = await b2.newContext({ userAgent: H["User-Agent"] })
await ctx2.addCookies([{ name: "__client", value: cj, domain: ".cartesia.ai", path: "/" }])
const p2 = await ctx2.newPage()
p2.setDefaultTimeout(90000)
const captured = []
const NOISE = /datadoghq|gstatic|gravatar|clerk\.com\/ins|prot\.clerk|mp\/track|google|facebook|analytics|sentry|amplitude|segment|mixpanel/i
p2.on("request", (req) => {
  const u = req.url()
  if (NOISE.test(u) || req.method() === "GET" && /\.(js|css|png|woff2?|ico|svg|map|ttf)$/.test(u)) return
  if (req.method() !== "GET") {
    const rec = { when: "req", method: req.method(), url: u.slice(0, 260), reqBody: (req.postData() || "").slice(0, 600), headers: { ct: req.headers()["content-type"] || "", auth: (req.headers()["authorization"] || "").slice(0, 40) } }
    captured.push(rec)
    console.log("[ALL-POST] " + rec.method + " " + u.slice(0, 170) + (rec.reqBody ? " body=" + rec.reqBody.slice(0, 200) : ""))
  }
})
p2.on("requestfinished", (req) => {
  const u = req.url()
  const res = req.response()
  if (!res) return
  if (NOISE.test(u)) return
  Promise.resolve().then(() => res.text()).then((b) => {
    const body = b || ""
    if (/sk_car_/i.test(body)) {
      const rec = { method: req.method(), status: res.status(), url: u.slice(0, 260), reqBody: (req.postData() || "").slice(0, 600), respBody: body.slice(0, 2500) }
      if (!captured.some(x => x.url === rec.url && x.method === rec.method && x.reqBody === rec.reqBody && x.status !== undefined)) {
        captured.push(rec)
        console.log("[SK-RESP] " + rec.method + " " + rec.status + " " + u.slice(0, 170))
        console.log("   req: " + rec.reqBody.slice(0, 300))
        console.log("   resp: " + rec.respBody.slice(0, 900))
      }
    }
  }).catch(() => {})
})
try {
  await p2.goto("https://play.cartesia.ai/keys", { waitUntil: "domcontentloaded", timeout: 120000 })
  for (let i = 0; i < 40; i++) { await p2.waitForTimeout(1500); const t = await p2.title().catch(() => ""); if (!/checkpoint/i.test(t)) break }
  await p2.waitForTimeout(5000)
  console.log("4) on /keys")

  async function acceptCookies() {
    for (let k = 0; k < 3; k++) {
      const banner = p2.locator("text=/we use cookies/i").first()
      if (!(await banner.isVisible().catch(() => false))) return
      const accept = p2.getByRole("button", { name: "Accept", exact: true }).first()
      try { await accept.click({ timeout: 8000 }) } catch { const bb = await accept.boundingBox().catch(() => null); if (bb) await p2.mouse.click(bb.x + 20, bb.y + 8) }
      await p2.waitForTimeout(1500)
    }
  }
  await acceptCookies()
  await p2.waitForTimeout(1500)

  // форма Create API key
  let form = null
  const findForm = async () => {
    const d = p2.locator('[data-slot="dialog-content"]')
    const n = await d.count()
    for (let i = 0; i < n; i++) {
      const t = (await d.nth(i).innerText().catch(() => "") || "")
      if (/api key/i.test(t) && (await d.nth(i).locator("input").count()) > 0 && !/only be shown once/i.test(t)) { form = d.nth(i); return true }
    }
    return false
  }
  if (!(await findForm())) {
    const btn = p2.locator('button:has-text("Create API key")').first()
    if (await btn.count()) {
      await btn.click({ timeout: 20000 }).catch(async () => { const bb = await btn.boundingBox(); if (bb) await p2.mouse.click(bb.x + 15, bb.y + 12) })
      await p2.waitForTimeout(2500)
      await findForm()
    }
  }
  console.log("5) form=" + (form ? "open" : "NOT FOUND"))
  if (form) {
    const nameInp = form.locator("input:visible").first()
    if (await nameInp.count()) { await nameInp.click({ timeout: 10000 }); await nameInp.type("Furia Key", { delay: 25 }) }
    await p2.waitForTimeout(300)
    const submit = form.locator("button:visible").filter({ hasText: /^Create$/ }).last()
    if (await submit.count()) {
      await submit.click({ timeout: 15000 }).catch(async () => { const bb = await submit.boundingBox(); if (bb) await p2.mouse.click(bb.x + 15, bb.y + 12) })
      console.log("5b) Create clicked")
    } else { await p2.keyboard.press("Enter") }
  }

  // --- очікування діалогу "Your new API key" + ключ ---
  let keyFromPage = null
  for (let i = 0; i < 40; i++) {
    await p2.waitForTimeout(2000)
    const dlg = p2.locator('[data-slot="dialog-content"]').filter({ hasText: /only be shown once/i }).first()
    const vis = await dlg.isVisible().catch(() => false)
    if (vis) {
      console.log("6) success dialog visible at +" + ((i + 1) * 2) + "s")
      // дістаємо ключ: input/textarea values + innerText + innerHTML
      const data = await dlg.evaluate((el) => {
        const inputs = Array.from(el.querySelectorAll("input, textarea, code, pre")).map((e) => e.value || e.textContent || "")
        return { values: inputs, text: el.innerText || "", html: el.innerHTML.slice(0, 6000) }
      }).catch(() => null)
      let m = null
      if (data) {
        const all = [data.values.join("\n"), data.text, data.html].join("\n")
        m = all.match(/sk_car_[A-Za-z0-9_-]{8,}/) || (all.match(/sk_car_[^\s"<]+/) && null)
        if (m) keyFromPage = m[0]
        else {
          // можливо key зашифрована/маскована в DOM (data атрибут, обфускований) — збережимо raw
          const alt = data.values.filter(v => v.length > 30 && !/•|\*|…/.test(v))
          if (alt.length) { keyFromPage = alt[0]; console.log("6a) alt value (len=" + alt[0].length + "): " + alt[0].slice(0, 30) + "...") }
          else console.log("6a) NO sk_car_ in dialog. values len=" + data.values.map(v => v.length).join(",") + " text: " + data.text.replace(/\n/g, " ").slice(0, 250) + " html: " + data.html.slice(0, 400))
        }
      }
      if (keyFromPage) console.log("6b) KEY=" + keyFromPage.slice(0, 28) + "..." + keyFromPage.slice(-6))
      else { await p2.screenshot({ path: "C:/Users/J0hnD03/AppData/Local/Temp/e2e11g_dlg.png" }).catch(() => {}); console.log("6c) screenshot saved (no key extracted)") }
      break
    }
  }

  // --- вилізання key прямо з XHR-запиту на api.cartesia.ai через in-page fetch (якщо ще не знайшли) ---
  if (!keyFromPage) {
    const probeRes = await p2.evaluate(async () => {
      const out = []
      const cands = [
        ["GET", "https://api.cartesia.ai/v1/keys"],
        ["GET", "https://api.cartesia.ai/keys"],
        ["GET", "https://clerk.cartesia.ai/v1/client/api_keys"],
        ["POST", "https://clerk.cartesia.ai/v1/client/api_keys"]
      ]
      for (const [m, url] of cands) {
        try {
          const r = await fetch(url, { method: m, credentials: "include", headers: m === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}, body: m === "POST" ? new URLSearchParams({ x: "" }).toString() : undefined })
          const t = (await r.text()).slice(0, 300)
          out.push({ url, m, status: r.status, body: t.replace(/\s+/g, " ").slice(0, 250) })
        } catch (e) { out.push({ url, m, err: String(e).slice(0, 100) }) }
      }
      return out
    })
    for (const pr of probeRes) console.log("PROBE " + pr.m + " " + (pr.status ?? "ERR") + " " + pr.url + " :: " + (pr.body || pr.err || "").slice(0, 200))
  }

  await b2.close()
  fs.writeFileSync("C:/Users/J0hnD03/AppData/Local/Temp/furia_key_xhr.json", JSON.stringify({ email, key: keyFromPage, captured }, null, 2))
  console.log("SAVED furia_key_xhr.json — " + Math.round((Date.now() - t_all) / 1000) + "s — captured=" + captured.length)
} catch (e) {
  console.log("FATAL: " + (e && e.message).slice(0, 500))
  await p2.screenshot({ path: "C:/Users/J0hnD03/AppData/Local/Temp/e2e11g_fatal.png" }).catch(() => {})
  try { fs.writeFileSync("C:/Users/J0hnD03/AppData/Local/Temp/furia_key_xhr.json", JSON.stringify({ email, key: null, captured, fatal: String(e && e.message) }, null, 2)) } catch {}
  await b2.close()
  process.exit(1)
}
