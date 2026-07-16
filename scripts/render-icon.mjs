// Рендер іконки додатку: скелет YT CARTEL на темному тлі → build/icon.png (512×512)
import { chromium } from 'playwright'

const html = `<!doctype html><html><body style="margin:0">
<div id="icon" style="width:512px;height:512px;background:#141311;border-radius:96px;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden">
  <div style="position:absolute;inset:-10%;background:radial-gradient(circle at 50% 42%, rgba(217,119,87,.5) 0%, transparent 60%)"></div>
  <svg viewBox="0 0 200 236" width="430" height="507" xmlns="http://www.w3.org/2000/svg" style="position:relative;margin-top:14px">
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
  </svg>
</div>
</body></html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 512, height: 512 } })
await page.setContent(html)
await page.locator('#icon').screenshot({ path: 'build/icon.png', omitBackground: true })
await browser.close()
console.log('build/icon.png оновлено')
