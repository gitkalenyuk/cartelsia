// Промо-банер для Telegram-поста: 1280×720 → docs/promo.png
import { chromium } from 'playwright'
import { readFileSync } from 'fs'

const screenshot = readFileSync('docs/screenshots/generation.png').toString('base64')

const skull = `<svg viewBox="0 0 200 236" width="150" height="177" xmlns="http://www.w3.org/2000/svg">
  <g>
    <path d="M38 236 C40 204 66 188 100 188 C134 188 160 204 162 236 Z" fill="#f2efe6" stroke="#111" stroke-width="5"/>
    <path d="M78 196 L100 236 L122 196 C115 190 85 190 78 196 Z" fill="#1b1b1b"/>
    <path d="M100 196 L109 208 L104 232 L100 236 L96 232 L91 208 Z" fill="#c81e1e" stroke="#111" stroke-width="3"/>
  </g>
  <g>
    <path d="M100 34 C58 34 40 62 40 96 C40 118 48 136 62 146 L62 164 C62 172 68 178 76 178 L124 178 C132 178 138 172 138 164 L138 146 C152 136 160 118 160 96 C160 62 142 34 100 34 Z" fill="#f5f2e9" stroke="#111" stroke-width="6"/>
    <path d="M56 128 C60 138 66 144 74 148" fill="none" stroke="#111" stroke-width="4" stroke-linecap="round"/>
    <path d="M144 128 C140 138 134 144 126 148" fill="none" stroke="#111" stroke-width="4" stroke-linecap="round"/>
    <path d="M100 118 L92 134 C96 138 104 138 108 134 Z" fill="#111"/>
    <g>
      <rect x="52" y="88" width="42" height="26" rx="9" fill="#101010" stroke="#111" stroke-width="4"/>
      <rect x="106" y="88" width="42" height="26" rx="9" fill="#101010" stroke="#111" stroke-width="4"/>
      <path d="M94 99 L106 99" stroke="#111" stroke-width="5"/>
      <path d="M52 98 L42 94 M148 98 L158 94" stroke="#111" stroke-width="4" stroke-linecap="round"/>
      <path d="M60 94 L70 92" stroke="#8fd3ff" stroke-width="3" stroke-linecap="round"/>
      <path d="M114 94 L124 92" stroke="#8fd3ff" stroke-width="3" stroke-linecap="round"/>
    </g>
    <g fill="#f5f2e9" stroke="#111" stroke-width="3">
      <path d="M74 148 L126 148 L126 160 C126 163 123 166 120 166 L80 166 C77 166 74 163 74 160 Z"/>
      <path d="M85 148 L85 165 M96 148 L96 166 M107 148 L107 166 M118 148 L118 165" fill="none"/>
    </g>
    <g transform="translate(0 3)">
      <path d="M76 170 C76 166 80 164 84 164 L116 164 C120 164 124 166 124 170 L124 176 C124 183 118 188 111 188 L89 188 C82 188 76 183 76 176 Z" fill="#f5f2e9" stroke="#111" stroke-width="5"/>
      <path d="M90 165 L90 187 M100 165 L100 188 M110 165 L110 187" fill="none" stroke="#111" stroke-width="3"/>
    </g>
    <g>
      <path d="M30 66 C30 56 44 50 100 50 C156 50 170 56 170 66 C170 74 156 78 100 78 C44 78 30 74 30 66 Z" fill="#f2efe6" stroke="#111" stroke-width="5"/>
      <path d="M56 58 C56 30 70 14 100 14 C130 14 144 30 144 58 C130 64 70 64 56 58 Z" fill="#f2efe6" stroke="#111" stroke-width="6"/>
      <path d="M54 58 C54 48 60 44 100 44 C140 44 146 48 146 58 C132 65 68 65 54 58 Z" fill="#151515"/>
    </g>
  </g>
</svg>`

const html = `<!doctype html><html><head><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Segoe UI', system-ui, sans-serif; }
  .banner {
    width:1280px; height:720px; position:relative; overflow:hidden;
    background:
      radial-gradient(900px 600px at 12% 8%, rgba(217,119,87,.28) 0%, transparent 55%),
      radial-gradient(700px 500px at 95% 100%, rgba(200,30,30,.16) 0%, transparent 55%),
      linear-gradient(135deg, #17150f 0%, #1a1915 55%, #14120e 100%);
    display:flex; align-items:center;
  }
  .left { width:520px; padding:56px 0 56px 60px; position:relative; z-index:2; }
  .logo-row { display:flex; align-items:center; gap:22px; margin-bottom:26px; }
  .brand { }
  .brand .yt { font-size:15px; font-weight:800; letter-spacing:4px; color:#ff4d42;
    text-shadow:0 0 14px rgba(255,77,66,.6); }
  .brand h1 { font-size:64px; font-weight:800; color:#f5f4ed; letter-spacing:1px; line-height:1.05; }
  .brand h1 span { color:#d97757; }
  .tagline { font-size:21px; color:#b8b5a9; margin-bottom:30px; line-height:1.45; }
  .tagline b { color:#f5f4ed; }
  .features { display:flex; flex-direction:column; gap:13px; margin-bottom:32px; }
  .feature { display:flex; align-items:center; gap:12px; font-size:17.5px; color:#d8d5c9; }
  .feature .ico { width:30px; height:30px; border-radius:8px; background:rgba(217,119,87,.16);
    border:1px solid rgba(217,119,87,.35); display:flex; align-items:center; justify-content:center;
    font-size:15px; flex-shrink:0; }
  .badges { display:flex; gap:10px; }
  .badge { padding:8px 18px; border-radius:999px; font-size:14.5px; font-weight:700; letter-spacing:.5px; }
  .badge--accent { background:#d97757; color:#fff; box-shadow:0 4px 24px rgba(217,119,87,.45); }
  .badge--ghost { border:1.5px solid #4d4b44; color:#b8b5a9; }
  .shot-wrap { position:absolute; right:-120px; top:70px; z-index:1; transform:rotate(-2.5deg); }
  .shot {
    width:840px; border-radius:14px; overflow:hidden;
    border:1.5px solid #3e3d38;
    box-shadow: 0 30px 90px rgba(0,0,0,.65), 0 0 0 1px rgba(217,119,87,.15), 0 0 120px rgba(217,119,87,.12);
  }
  .shot img { width:100%; display:block; }
  .shot-bar { height:30px; background:#1f1e1b; border-bottom:1px solid #33322d;
    display:flex; align-items:center; gap:7px; padding:0 14px; }
  .dot { width:9px; height:9px; border-radius:50%; }
  .footer { position:absolute; left:60px; bottom:34px; z-index:2; display:flex; align-items:center; gap:12px;
    font-size:15.5px; color:#8a877c; }
  .footer .gh { color:#d8d5c9; font-weight:600; }
  .skull-glow { position:absolute; inset:-25%; border-radius:50%;
    background:radial-gradient(circle, rgba(217,119,87,.55) 0%, transparent 62%); filter:blur(14px); }
  .skull-box { position:relative; }
</style></head><body>
<div class="banner" id="banner">
  <div class="left">
    <div class="logo-row">
      <div class="skull-box"><div class="skull-glow"></div><div style="position:relative">${skull}</div></div>
      <div class="brand">
        <div class="yt">YT CARTEL</div>
        <h1>Cartel<span>sia</span></h1>
      </div>
    </div>
    <div class="tagline">Своя студія озвучки на <b>Cartesia AI</b>:<br/>безлімітно на пулі безкоштовних ключів</div>
    <div class="features">
      <div class="feature"><span class="ico">🎙</span>42 мови · 🇺🇦 українська · семпли голосів</div>
      <div class="feature"><span class="ico">🔑</span>Пул ключів: авто-облік лімітів і заморозка</div>
      <div class="feature"><span class="ico">⚡</span>Паралельна озвучка → склейка в один MP3</div>
      <div class="feature"><span class="ico">🎭</span>Клони голосів · субтитри SRT · статистика</div>
    </div>
    <div class="badges">
      <div class="badge badge--accent">БЕЗКОШТОВНО</div>
      <div class="badge badge--ghost">Windows · portable .exe</div>
    </div>
  </div>
  <div class="shot-wrap">
    <div class="shot">
      <div class="shot-bar">
        <span class="dot" style="background:#e5695e"></span>
        <span class="dot" style="background:#d4a027"></span>
        <span class="dot" style="background:#7fa66f"></span>
      </div>
      <img src="data:image/png;base64,${screenshot}"/>
    </div>
  </div>
  <div class="footer">📥 <span class="gh">github.com/gitkalenyuk/cartelsia</span> · код відкритий — кастомізуй під себе</div>
</div>
</body></html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })
await page.setContent(html)
await page.waitForTimeout(300)
await page.locator('#banner').screenshot({ path: 'docs/promo.png' })
await browser.close()
console.log('docs/promo.png готово')
