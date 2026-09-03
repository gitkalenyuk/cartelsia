import { describe, expect, it } from 'vitest'
import { parseProxyLines } from '../src/main/proxy/proxyManager'

describe('parseProxyLines (2.1.2 розширення)', () => {
  it('класичні формати як раніше', () => {
    const text = [
      '1.2.3.4:8080',
      '1.2.3.5:8080:user:pass',
      'http://u:p@1.2.3.6:8080',
      '',
      '# коментар'
    ].join('\n')
    const out = parseProxyLines(text)
    expect(out).toContain('http://1.2.3.4:8080')
    expect(out).toContain('http://user:pass@1.2.3.5:8080')
    expect(out).toContain('http://u:p@1.2.3.6:8080')
    expect(out).toHaveLength(3)
  })

  it('socks5:// протокол зберігається', () => {
    const out = parseProxyLines('socks5://1.2.3.4:1080')
    expect(out).toContain('socks5://1.2.3.4:1080')
  })

  it('дедублікація і нормалізація', () => {
    const out = parseProxyLines('1.2.3.4:8080\nhttp://1.2.3.4:8080\n1.2.3.4:8080')
    expect(out).toHaveLength(1)
  })

  it('URL-и в тексті/html витягуються', () => {
    const out = parseProxyLines('<a href="http://5.6.7.8:3128">proxy</a>')
    expect(out).toContain('http://5.6.7.8:3128')
  })
})
