import { ProxyAgent, fetch as undiciFetch } from 'undici'

export interface ProxyEntry {
  url: string
  status: 'unchecked' | 'working' | 'dead'
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
    const cred = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d+):([^:\s]+):(.+)$/.exec(line)
    if (cred) {
      const [, ip, port, user, pass] = cred
      out.push(`http://${user}:${pass}@${ip}:${port}`)
      continue
    }
    if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(line)) { out.push('http://' + line); continue }
    // URL-и всередині html/тексту
    const embedded = line.match(/https?:\/\/[^\s'"<>]+/g)
    if (embedded) out.push(...embedded)
  }
  return [...new Set(out)]
}

export class ProxyManager {
  private proxies: ProxyEntry[] = []
  private currentIndex = 0

  /** Грабимо проксі зі сторінки (plain text / html). Повертаємо унікальні рядки. */
  async fetchFromUrl(url: string): Promise<string[]> {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    const text = await res.text()
    return parseProxyLines(text)
  }

  /** Імпорт з тексту (multiline): http://u:p@ip:port | ip:port | ip:port:user:pass */
  addFromText(text: string): number {
    const urls = parseProxyLines(text)
    const before = this.proxies.length
    this.addProxies(urls)
    return this.proxies.length - before
  }

  /** Перевіряємо проксі: запит до clerk.cartesia.ai через ProxyAgent. */
  async checkProxy(proxyUrl: string): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now()
    try {
      const agent = new ProxyAgent(proxyUrl)
      const res = await undiciFetch(
        'https://clerk.cartesia.ai/v1/client?__clerk_api_version=2026-05-12',
        {
          dispatcher: agent as any,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          signal: AbortSignal.timeout(15000)
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
    return /^https?:\/\//.test(url) ? url : 'http://' + url
  }

  async checkAll(): Promise<void> {
    for (const p of this.proxies) {
      const res = await this.checkProxy(p.url)
      p.status = res.ok ? 'working' : 'dead'
      p.lastChecked = new Date().toISOString()
      p.latencyMs = res.latencyMs
    }
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
  }
}
