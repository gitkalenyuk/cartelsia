// E2E #11c: тільки /keys + XHR перехоплення, сесія з минулого циклу
import fs from "fs"
import { chromium } from "playwright"
const H = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36" }
const saved = JSON.parse(fs.readFileSync("C:/Users/J0hnD03/AppData/Local/Temp/furia_e2e11_session.json", "utf8"))
const cj = saved.clientCookie
if (!cj) { console.log("no clientCookie saved"); process.exit(1) }
const b2 = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-gpu"] })
const ctx2 = await b2.newContext({ userAgent: H["User-Agent"] })
await ctx2.addCookies([
  { name: "__client", value: cj, domain: "play.cartesia.ai", path: "/" },
  { name: "__client", value: cj, domain: ".play.cartesia.ai", path: "/" },
])
const p2 = await ctx2.newPage()
p2.setDefaultTimeout(90000)
const captured = []
p2.on("requestfinished", async (req) => {
  const u = req.url()
  const res = req.response()
  if (!res) return
  if (req.method() === "GET" && /\.(js|css|png|woff|ico|svg|map)/.test(u)) return
  if (/fonts\.google|gstatic|img\.clerk\.com|images\.clerk\.dev|gravatar/.test(u)) return
  let body = ""
  try { body = await res.text() } catch {}
  if (!/clerk|cartesia|keys|api/.test(u + body.slice(0, 200))) return
  const rec = { method: req.method(), url: u.slice(0, 220), status: typeof res.status === "function" ? res.status() : res.status, reqBody: (req.postData() || "").slice(0, 400), respBody: body.slice(0, 900) }
  captured.push(rec)
  console.log("[XHR] " + req.method() + " " + rec.status + " " + u.slice(0, 140))
})
await p2.goto("https://play.cartesia.ai/keys", { waitUntil: "domcontentloaded", timeout: 90000 })
for (let i = 0; i < 30; i++) { await p2.waitForTimeout(1500); const t = await p2.title(); if (!/checkpoint/i.test(t)) break }
console.log("title=" + await p2.title())
for (let i = 0; i < 50; i++) { await p2.waitForTimeout(1000); const hasUi = await p2.evaluate(() => /api key/i.test(document.body.innerText || "")); if (hasUi) break }
console.log("page text: " + (await p2.evaluate(() => (document.body.innerText || "").slice(0, 300))).replace(/\n/g, " | "))
const btn = await p2.$('button:has-text("Create API key")')
if (btn) { await btn.click(); console.log("clicked Create API key"); await p2.waitForTimeout(2000) }
else console.log("NO create btn; buttons: " + (await p2.$$eval("button", bs => bs.map(b => (b.textContent || "").trim()).filter(Boolean).slice(0, 12)).join(" | ")))
const inputs = await p2.$$eval("input", els => els.map(e => ({ ph: e.placeholder || "", val: e.value, type: e.type })).slice(0, 8))
console.log("inputs: " + JSON.stringify(inputs).slice(0, 400))
const nameInput = await p2.$("input")
if (nameInput) { await nameInput.type("Furia Key", { delay: 30 }) }
await p2.waitForTimeout(500)
await p2.keyboard.press("Enter")
console.log("pressed Enter")
await p2.waitForTimeout(5000)
const finalText = await p2.evaluate(() => (document.body.innerText || "").slice(0, 1200))
console.log("final: " + finalText.replace(/\n/g, " | ").slice(0, 500))
await b2.close()
fs.writeFileSync("C:/Users/J0hnD03/AppData/Local/Temp/furia_key_xhr.json", JSON.stringify({ captured }, null, 2))
console.log("SAVED furia_key_xhr.json, " + captured.length + " captured")
