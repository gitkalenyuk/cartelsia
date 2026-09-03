import { ProxyAgent, fetch as undiciFetch } from 'undici'
import { EventEmitter } from 'events'

export interface ProxyEntry {
  url: string
  status: 'unchecked' | 'working' | 'dead' | 'checking'
  lastChecked?: string
  latencyMs?: number
}

/** Парсить multiline-текст з проксі у нормалізовані URL. Формати:
 *  http://u:p@ip:port | http://ip:port | ip:port | ip:port:user:pass. Дедублікує. */
export function parseProxyLines(text: string): string[] {
  const out: string[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    if (/^https?:\/\//.test(line)) { out.push(line); continue }
    if (/^socks5:\/\//.test(line)) { out.push(line); continue } // 2.1.2: socks5 підтримка
    const cred = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d+):([^:\s]+):(.+)$/.exec(line)
    if (cred) {
      const [, ip, port, user, pass] = cred
      out.push(`http://${user}:${pass}@${ip}:${port}`)
      continue
    }
    if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(line)) { out.push('http://' + line); continue }
    // 2.1.2: socks5 ip:port / user:pass@ip:port:socks5
    const socks = /^(socks5:\/\/)?([^@\s]+)@?([\d.]+):(\d+)$/.exec(line)
    if (socks && line.includes('socks5')) {
      out.push(line.startsWith('socks5://') ? line : `socks5://${line.replace(/^socks5:\/\//, '')}`)
      continue
    }
    // URL-и всередині html/тексту
    const embedded = line.match(/https?:\/\/[^\s'"<>]+/g)
    if (embedded) out.push(...embedded)
  }
  return [...new Set(out)]
}

export class ProxyManager extends EventEmitter {
  private proxies: ProxyEntry[] = []
  private currentIndex = 0
  /** 2.1.2: прапор переривання потокового чекінгу */
  private checkAborted = false
  /** 2.1.2:persist у файл (проксі переживають рестарт) */
  persistPath: string | null = null

  /** Грабимо проксі зі сторінки (plain text / html). Повертаємо унікальні рядки. */
  async fetchFromUrl(url: string): Promise<string[]> {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    const text = await res.text()
    return parseProxyLines(text)
  }

  /** Імпорт з тексту (multiline): http://u:p@ip:port | ip:port | ip:port:user:pass | socks5://... */
  addFromText(text: string): number {
    const urls = parseProxyLines(text)
    const before = this.proxies.length
    this.addProxies(urls)
    this.persist()
    return this.proxies.length - before
  }

  /** Перевіряємо проксі: запит до clerk.cartesia.ai через ProxyAgent. */
  async checkProxy(proxyUrl: string, timeoutMs = 12_000): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now()
    try {
      const agent = new ProxyAgent(proxyUrl)
      const res = await undiciFetch(
        'https://clerk.cartesia.ai/v1/client?__clerk_api_version=2026-05-12',
        {
          dispatcher: agent as never,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          signal: AbortSignal.timeout(timeoutMs)
        }
      )
      // Будь-яка відповідь (200/401/403/404) означає що проксі дійшов до сервера
      const ok = res.status === 200 || res.status === 401 || res.status === 403 || res.status === 404
      return { ok, latencyMs: Date.now() - start }
    } catch {
      return { ok: false, latencyMs: Date.now() - start }
    }
  }

  addProxies(urls: string[]) {
    for (const url of urls) {
      const normalized = this.normalize(url)
      if (!this.proxies.find((p) => p.url === normalized)) {
        this.proxies.push({ url: normalized, status: 'unchecked' })
      }
    }
  }

  private normalize(url: string): string {
    return /^(https?|socks5):\/\//.test(url) ? url : 'http://' + url
  }

  /**
   * 2.1.2: REALTIME перевірка: N паралельних потоків, кожен завершений проксі
   * одразу емітить 'proxy-updated' (UI малює живий статус), статус 'checking'
   * виставляється до старту. stopCheck() перериває подальші запуски.
   */
  async checkAllRealtime(opts: { threads?: number; timeoutMs?: number } = {}): Promise<void> {
    const threads = Math.max(1, Math.min(50, opts.threads ?? 10))
    const timeoutMs = opts.timeoutMs ?? 12_000
    this.checkAborted = false
    const targets = this.proxies.filter((p) => p.status !== 'checking')
    for (const p of targets) p.status = 'checking'
    this.emit('proxies-updated')

    let idx = 0
    const worker = async (): Promise<void> => {
      while (!this.checkAborted) {
        const i = idx++
        if (i >= targets.length) return
        const p = targets[i]
        const res = await this.checkProxy(p.url, timeoutMs)
        // проксі могли видалити під час чеку
        const live = this.proxies.find((x) => x.url === p.url)
        if (live) {
          live.status = res.ok ? 'working' : 'dead'
          live.lastChecked = new Date().toISOString()
          live.latencyMs = res.latencyMs
          this.emit('proxies-updated')
          this.persist()
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(threads, targets.length) }, () => worker()))
    this.persist()
  }

  /** 2.1.2: перервати поточний чекінг (незавершені 'checking' → unchecked). */
  stopCheck(): void {
    this.checkAborted = true
    for (const p of this.proxies) {
      if (p.status === 'checking') p.status = 'unchecked'
      // проставити dead проксі без відповіді
    }
    this.emit('proxies-updated')
  }

  get checking(): boolean {
    return !this.checkAborted && this.proxies.some((p) => p.status === 'checking')
  }

  getCheckingCount(): number {
    return this.proxies.filter((p) => p.status === 'checking').length
  }

  /** 2.1.2: експорт списку в текст (для файлу/буфера) */
  exportText(masked = false): string {
    return this.proxies
      .map((p) => (masked ? p.url.replace(/\/\/([^@]+)@/, '//***@') : p.url))
      .join('\n')
  }

  getWorking(): string[] {
    return this.proxies.filter((p) => p.status === 'working').map((p) => p.url)
  }

  rotate(): string | null {
    const working = this.getWorking()
    if (working.length === 0) return null
    this.currentIndex = (this.currentIndex + 1) % working.length
    return working[this.currentIndex]
  }

  getCurrent(): string | null {
    const working = this.getWorking()
    if (working.length === 0) return null
    return working[this.currentIndex % working.length]
  }

  list(): ProxyEntry[] {
    return [...this.proxies]
  }

  remove(url: string): void {
    this.proxies = this.proxies.filter((p) => p.url !== url)
    this.persist()
  }

  clear(onlyDead = false): number {
    const before = this.proxies.length
    this.proxies = onlyDead
      ? this.proxies.filter((p) => p.status !== 'dead')
      : []
    this.persist()
    return before - this.proxies.length
  }

  // ── persist (2.1.2) ──
  private persist(): void {
    if (!this.persistPath) return
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { writeFileSync } = require('fs') as typeof import('fs')
      writeFileSync(this.persistPath, JSON.stringify({ proxies: this.proxies }), 'utf8')
    } catch { /* best effort */ }
  }

  loadPersisted(): void {
    if (!this.persistPath) return
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { readFileSync, existsSync } = require('fs') as typeof import('fs')
      if (existsSync(this.persistPath)) {
        const data = JSON.parse(readFileSync(this.persistPath, 'utf8')) as { proxies?: ProxyEntry[] }
        for (const p of data.proxies ?? []) {
          // checking-статуси з минулого крашу → unchecked
          this.proxies.push({ ...p, status: p.status === 'checking' ? 'unchecked' : p.status })
        }
      }
    } catch { /* ignore */ }
  }
}
