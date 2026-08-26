const fs = require('fs')
const f = 'C:/Users/J0hnD03/Desktop/Cartelsia/src/renderer/src/components/settings/SettingsView.tsx'
let s = fs.readFileSync(f, 'utf8')

// 1) Вставити функції перед останнім return (
const funcs = `
  const handleGrabProxies = async (): Promise<void> => {
    const url = settings.proxy?.grabUrl
    if (!url) { toast('info', 'Спочатку вкажіть URL для грабінга проксі'); return }
    setGrabbing(true)
    try {
      const res = await window.cartelsia.proxy.grab(url)
      toast('success', 'Зграблено ' + res.grabbed + ' проксі')
      const checkRes = await window.cartelsia.proxy.check()
      setProxyList(checkRes.proxies.map((p: any) => ({ url: p.url, status: p.status, latencyMs: p.latencyMs })))
      const working = checkRes.proxies.filter((p: any) => p.status === 'working').length
      toast('success', 'Працюють: ' + working + '/' + checkRes.proxies.length)
    } catch (err) {
      toast('danger', err instanceof Error ? err.message : String(err))
    } finally {
      setGrabbing(false)
    }
  }

  const handleRemoveProxy = async (url: string): Promise<void> => {
    const res = await window.cartelsia.proxy.remove(url)
    setProxyList(res.proxies.map((p: any) => ({ url: p.url, status: p.status, latencyMs: p.latencyMs })))
  }

`

// знайти останнє 'return (' перед <div>
const lastReturn = s.lastIndexOf('  return (\n    <div>\n      <h1 className="view-title">{t.settingsTitle}</h1>')
if (lastReturn === -1) {
  console.error('last return not found')
  process.exit(1)
}
s = s.slice(0, lastReturn) + funcs + s.slice(lastReturn)

// 2) Вставити секцію проксі перед sectionNotify
const proxySection = `
      <div className="settings-section">
        <div className="settings-section__title">Проксі</div>
        <Row label="URL для грабінга" desc="Посилання на сторінку зі списком проксі (plain text / html)">
          <input
            className="input"
            style={{ width: 280 }}
            placeholder="https://example.com/proxy-list"
            value={settings.proxy?.grabUrl ?? ''}
            onChange={(e) => void update({ proxy: { ...settings.proxy, grabUrl: e.target.value.trim() } })}
          />
        </Row>
        <Row label="">
          <button
            className="btn btn--primary btn--sm"
            onClick={() => void handleGrabProxies()}
            disabled={grabbing}
          >
            {grabbing ? 'Граблю…' : 'Grab + Check'}
          </button>
        </Row>
        {proxyList.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <table className="table">
              <thead>
                <tr><th>URL</th><th>Статус</th><th>Lat</th><th></th></tr>
              </thead>
              <tbody>
                {proxyList.map((p) => (
                  <tr key={p.url}>
                    <td className="mono text-sm" style={{ fontSize: 11, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.url}</td>
                    <td><span className={`badge ${p.status === 'working' ? 'badge--success' : p.status === 'dead' ? 'badge--danger' : 'badge--neutral'}`}>{p.status}</span></td>
                    <td className="text-sm muted">{p.latencyMs ? p.latencyMs + 'мс' : '—'}</td>
                    <td><button className="iconbtn" onClick={() => void handleRemoveProxy(p.url)} title="Видалити">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

`

const notifyIdx = s.indexOf('<div className="settings-section">\n        <div className="settings-section__title">{t.sectionNotify}</div>')
if (notifyIdx === -1) {
  console.error('notify section not found')
  process.exit(1)
}
s = s.slice(0, notifyIdx) + proxySection + s.slice(notifyIdx)

fs.writeFileSync(f, s)
console.log('SettingsView updated')
