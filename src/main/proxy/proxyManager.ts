import { ProxyAgent, fetch as undiciFetch } from 'undici'

export interface ProxyEntry {
  url: string
  status: 'unchecked' | 'working' | 'dead'
  lastChecked?: string
  latencyMs?: number
}

export class ProxyManager {
  private proxies: ProxyEntry[] = []
  private currentIndex = 0

  /** Грабимо проксі зі сторінки (plain text / html). Повертаємо унікальні рядки. */
  async fetchFromUrl(url: string): Promise<string[]> {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    const text = await res.text()

    // 1) http(s)://user:pass@ip:port або http(s)://ip:port
    const full = text.match(/https?:\/\/[^\s]+/g) || []

    // 2) ip:port (без протоколу)
    const raw = text.match(/\d+\.\d+\.\d+\.\d+:\d+/g) || []

    const all = [...full, ...raw.map((r) => 'http://' + r)]
    return [...new Set(all.filter((u) => /^https?:\/\/.+/.test(u)))]
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
