// E2E #11f: цикл + /keys cookie-aware (Accept cookie banner) + dialog-aware Create API key + XHR перехоп sk_car_
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

// ---- браузер: /keys + cookie banner + create dialog ----
const cj = ckMap.get("__client")
const b2 = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-gpu"] })
const ctx2 = await b2.newContext({ userAgent: H["User-Agent"] })
await ctx2.addCookies([{ name: "__client", value: cj, domain: ".cartesia.ai", path: "/" }])
const p2 = await ctx2.newPage()
p2.setDefaultTimeout(90000)
const captured = []
p2.on("requestfinished", (req) => {
  const u = req.url()
  const res = req.response()
  if (!res) return
  if (req.method() === "GET" && /\.(js|css|png|woff2?|ico|svg|map)$/.test(u)) return
  if (/datadoghq|gstatic|gravatar|clerk\.com\/ins|prot\.clerk|mp\/track/.test(u)) return
  Promise.resolve().then(() => res.text()).then((b) => {
    const body = b || ""
    const interesting = /sk_car_/i.test(body) || /api_keys/i.test(u) || /play\.cartesia\.ai\/api/.test(u) || (req.method() === "POST" && /clerk\.cartesia\.ai/.test(u))
    if (interesting) {
      const rec = { method: req.method(), status: res.status(), url: u.slice(0, 260), reqBody: (req.postData() || "").slice(0, 600), respBody: body.slice(0, 2000) }
      if (!captured.some(x => x.url === rec.url && x.method === rec.method && x.reqBody === rec.reqBody)) {
        captured.push(rec)
        console.log("[KEY-XHR] " + rec.method + " " + rec.status + " " + u.slice(0, 170))
        if (rec.reqBody) console.log("   req: " + rec.reqBody.slice(0, 300))
        console.log("   resp: " + rec.respBody.slice(0, 700))
      }
    }
  }).catch(() => {})
})
try {
  await p2.goto("https://play.cartesia.ai/keys", { waitUntil: "domcontentloaded", timeout: 120000 })
  for (let i = 0; i < 40; i++) { await p2.waitForTimeout(1500); const t = await p2.title().catch(() => ""); if (!/checkpoint/i.test(t)) break }
  console.log("4) title=" + await p2.title())
  await p2.waitForTimeout(5000)

  // --- 4a) cookie banner: Accept (точний текст "Accept", не "Accept all") ---
  async function acceptCookies(tag) {
    for (let k = 0; k < 3; k++) {
      const banner = p2.locator("text=/we use cookies/i").first()
      if (!(await banner.isVisible().catch(() => false))) return false
      const accept = p2.getByRole("button", { name: "Accept", exact: true }).first()
      try {
        await accept.click({ timeout: 8000 })
        await p2.waitForTimeout(1500)
        console.log(tag + " cookie Accept clicked")
      } catch (e) {
        // fallback: force click по координатам
        const bb = await accept.boundingBox().catch(() => null)
        if (bb) { await p2.mouse.click(bb.x + 20, bb.y + 8); await p2.waitForTimeout(1500) }
      }
    }
    return !(await p2.locator("text=/we use cookies/i").first().isVisible().catch(() => false))
  }
  const cookiesGone = await acceptCookies("4a) ")
  console.log("4b) cookie banner gone=" + cookiesGone)
  await p2.waitForTimeout(2000)

  // --- dialogs: дістати форму Create API key ---
  const dialogs = p2.locator('[data-slot="dialog-content"]')
  const dCount = await dialogs.count()
  console.log("4c) dialog count=" + dCount)
  const dTexts = []
  for (let i = 0; i < dCount; i++) dTexts.push((await dialogs.nth(i).innerText().catch(() => "") || "").replace(/\n/g, " ").slice(0, 160))
  console.log("4d) dialogs: " + JSON.stringify(dTexts))

  let form = null
  for (let i = 0; i < dCount; i++) {
    const t = (await dialogs.nth(i).innerText().catch(() => "") || "")
    if (/api key/i.test(t) && (await dialogs.nth(i).locator("input").count()) > 0) { form = dialogs.nth(i); break }
  }
  if (!form) {
    // закрити не-API-дивалоги (cookie banner якщо ще, onboarding)
    for (let i = 0; i < dCount; i++) {
      const t = (await dialogs.nth(i).innerText().catch(() => "") || "")
      if (!/api key/i.test(t)) { await p2.keyboard.press("Escape"); await p2.waitForTimeout(1000) }
    }
    const btn = p2.locator('button:has-text("Create API key")').first()
    if (await btn.count()) { await btn.click({ timeout: 20000 }).catch(async () => { const bb = await btn.boundingBox(); if (bb) await p2.mouse.click(bb.x + 15, bb.y + 12) }); await p2.waitForTimeout(2500) }
    const d2 = p2.locator('[data-slot="dialog-content"]')
    for (let i = 0; i < (await d2.count()); i++) {
      const t = (await d2.nth(i).innerText().catch(() => "") || "")
      if (/api key/i.test(t) && (await d2.nth(i).locator("input").count()) > 0) { form = d2.nth(i); break }
    }
  }

  console.log("5) create form=" + (form ? "open" : "NOT FOUND"))
  if (form) {
    const labels = await form.locator("input, textarea, label, select, button").allTextContents().catch(() => [])
    const btnLabels = await form.locator("button:visible").allTextContents().catch(() => [])
    console.log("5b) form controls: " + JSON.stringify(labels.filter(Boolean).slice(0, 20)))
    console.log("5c) form buttons: " + JSON.stringify(btnLabels.filter(Boolean).slice(0, 10)))
    const nameInp = form.locator("input:visible").first()
    if (await nameInp.count()) { await nameInp.click({ timeout: 10000 }); await nameInp.type("Furia Key", { delay: 25 }); console.log("5d) typed name") }
    const submit = form.locator("button:visible").filter({ hasText: /^Create$/ }).last()
    if (await submit.count()) {
      await submit.click({ timeout: 15000 }).catch(async () => { const bb = await submit.boundingBox(); if (bb) await p2.mouse.click(bb.x + 15, bb.y + 12) })
      console.log("5e) clicked Create submit")
    } else { await p2.keyboard.press("Enter"); console.log("5e) Enter fallback") }
  }

  // --- очікуєм sk_car_ 60с ---
  let keyFromPage = null
  for (let i = 0; i < 30; i++) {
    await p2.waitForTimeout(2000)
    const txt = await p2.evaluate(() => (document.body ? document.body.innerText : "") || "").catch(() => "")
    const m = txt.match(/sk_car_[A-Za-z0-9_-]{8,}/)
    if (m) { keyFromPage = m[0]; console.log("6) SK FOUND at +" + ((i + 1) * 2) + "s: " + keyFromPage.slice(0, 24) + "..."); break }
    if (i === 29) {
      console.log("6) no key in 60s. text: " + txt.replace(/\n/g, " | ").slice(0, 400))
      // ще screenshot
      await p2.screenshot({ path: "C:/Users/J0hnD03/AppData/Local/Temp/e2e11f_nosk.png" }).catch(() => {})
      // dialog-состояння
      const dd = p2.locator('[data-slot="dialog-content"]')
      for (let k = 0; k < (await dd.count()); k++) console.log("   dlg" + k + ": " + ((await dd.nth(k).innerText().catch(() => "") || "").replace(/\n/g, " ").slice(0, 200)))
    }
  }

  // --- in-page probe clerk api_keys маршрутів (якщо XHR не показав) ---
  const probeRes = await p2.evaluate(async () => {
    const out = []
    const cands = ["https://clerk.cartesia.ai/v1/api_keys", "https://clerk.cartesia.ai/api_keys"]
    for (const url of cands) {
      try {
        const r = await fetch(url, { method: "GET", credentials: "include" })
        const t = (await r.text()).slice(0, 300)
        out.push({ url, m: "GET", status: r.status, body: t.replace(/\s+/g, " ").slice(0, 250) })
      } catch (e) { out.push({ url, m: "GET", err: String(e).slice(0, 100) }) }
    }
    return out
  })
  for (const pr of probeRes) console.log("PROBE " + pr.m + " " + (pr.status ?? "ERR") + " " + pr.url + " :: " + (pr.body || pr.err || "").slice(0, 180))

  await b2.close()
  fs.writeFileSync("C:/Users/J0hnD03/AppData/Local/Temp/furia_key_xhr.json", JSON.stringify({ email, captured, probeRes, key: keyFromPage }, null, 2))
  console.log("SAVED furia_key_xhr.json — " + Math.round((Date.now() - t_all) / 1000) + "s — captured=" + captured.length)
} catch (e) {
  console.log("FATAL: " + (e && e.message).slice(0, 500))
  await p2.screenshot({ path: "C:/Users/J0hnD03/AppData/Local/Temp/e2e11f_fatal.png" }).catch(() => {})
  try { fs.writeFileSync("C:/Users/J0hnD03/AppData/Local/Temp/furia_key_xhr.json", JSON.stringify({ email, captured, fatal: String(e && e.message) }, null, 2)) } catch {}
  await b2.close()
  process.exit(1)
}
