// E2E #13: ІМПОРТУЄ СПІВНІ project clerkClient.ts i виконує повний browserless цикл одного акаунта
import { build } from "esbuild"
import fs from "fs"
const BUNDLE = "C:/Users/J0hnD03/Desktop/Cartelsia/scripts/.tmp_clerk_bundle.mjs"
await build({
  entryPoints: ["C:/Users/J0hnD03/Desktop/Cartelsia/src/main/email/clerkClient.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: BUNDLE,
  external: ["playwright"],
  logLevel: "warning"
})
console.log("0) bundle built")
const { SpecterProvider, registerOneBrowserless } = await import("./.tmp_clerk_bundle.mjs")

import tls from "tls"
const IMAP = { host: "imap.gmail.com", port: 993, user: "nameofsewar@gmail.com", pass: "kvti mrvs iqmr wufe" }
let cur = null
function imapConnect() {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host: IMAP.host, port: IMAP.port, rejectUnauthorized: false })
    sock.setEncoding("utf8")
    let lineBuf = "", active = null, grepped = false, seq = 0
    sock.on("data", (d) => {
      lineBuf += d
      let idx
      while ((idx = lineBuf.indexOf("\r\n")) >= 0) {
        const line = lineBuf.slice(0, idx); lineBuf = lineBuf.slice(idx + 2)
        if (!grepped && line.startsWith("* OK")) { grepped = true; resolve({ sock, cmd }); continue }
        const m = line.match(/^(C\d+) (OK|NO|BAD)(?: \[([^\]]*)\])?\s?(.*)$/)
        if (active && m && m[1] === active.tag) { const a = active; active = null; a.res((a.data ? a.data + "\r\n" : "") + line) }
        else if (active) active.data += line + "\n"
      }
    })
    sock.on("error", reject)
    setTimeout(() => { if (!grepped) reject(new Error("greet timeout")) }, 10000)
    function cmd(c) { return new Promise((res, rej) => { const tag = "C" + (++seq); active = { tag, data: "", res }; sock.write(tag + " " + c + "\r\n"); setTimeout(() => { if (active && active.tag === tag) { active = null; rej(new Error("cmd timeout")) } }, 30000) }) }
  })
}
const MN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
const since = String(new Date().getDate()).padStart(2, "0") + "-" + MN[new Date().getMonth()] + "-" + new Date().getFullYear()
function otpFor(emailS) {
  const t0 = Date.now()
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const so = await cur.cmd("UID SEARCH SINCE " + since)
        const uids = (so.match(/SEARCH\s+([\d\s]+)/)?.[1] || "").trim().split(/\s+/).filter(Boolean)
        for (const uid of uids.slice(-6).reverse()) {
          const f = await cur.cmd("UID FETCH " + uid + " (BODY.PEEK[HEADER.FIELDS (TO)] BODY.PEEK[TEXT])")
          const dec = f.replace(/=3D/g, "=").replace(/[0-9a-fA-F]{2}=/g, (m) => { const c = parseInt(m.slice(0, 2), 16); return (c >= 32 && c < 127) ? String.fromCharCode(c) : "?" })
          const to = (dec.match(/To[:(]\s*([^\r\n]+)/i) || [""])[0].trim()
          if (!to.includes(emailS)) continue
          const d2 = dec.match(/>(\d{6})</)
          if (d2) { resolve(d2[1]); return }
        }
      } catch (e) { /* transient */ }
      if (Date.now() - t0 > 180000) { reject(new Error("OTP timeout")); return }
      setTimeout(tick, 6000)
    }
    tick()
  })
}

const t_all = Date.now()
const s = await imapConnect()
await s.cmd("LOGIN " + JSON.stringify(IMAP.user) + " " + JSON.stringify(IMAP.pass))
await s.cmd("SELECT INBOX")
cur = s
console.log("1) imap ok")
const sp = new SpecterProvider()
try {
  const spec = await sp.ensure()
  console.log("2) specter=" + spec.cid + " exp=" + spec.exp)
  const tt = Date.now().toString(36)
  const email = "furia_" + tt + "@furia.ink"
  const pass = "Furia_" + tt.slice(-3).toUpperCase() + "ab1!9"
  console.log("3) registering " + email)
  const res = await registerOneBrowserless({ email, pass, specter: spec, otpProvider: (e) => otpFor(e), keyDescription: "TS-Client Test" })
  console.log("4) RESULT key=" + res.key.slice(0, 22) + "...")
  console.log("   session: " + JSON.stringify(res.session))
  fs.writeFileSync("C:/Users/J0hnD03/AppData/Local/Temp/furia_e2e13_ts.json", JSON.stringify({ ts: new Date().toISOString(), sec: Math.round((Date.now() - t_all) / 1000), key: res.key, session: res.session, email: res.email }, null, 2))
  console.log("TOTAL " + Math.round((Date.now() - t_all) / 1000) + "s")
} finally {
  await sp.close()
  try { cur.cmd("LOGOUT").catch(() => {}); cur.sock.end() } catch {}
  try { fs.unlinkSync("C:/Users/J0hnD03/Desktop/Cartelsia/scripts/.tmp_clerk_bundle.mjs") } catch {}
}
