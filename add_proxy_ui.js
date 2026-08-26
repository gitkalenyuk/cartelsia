const fs = require('fs')
const f = 'C:/Users/J0hnD03/Desktop/Cartelsia/src/renderer/src/components/settings/SettingsView.tsx'
let s = fs.readFileSync(f, 'utf8')

// Додати стани якщо ще немає
if (!s.includes('const [grabbing, setGrabbing]')) {
  s = s.replace(
    'const [testingImap, setTestingImap] = useState(false)',
    'const [testingImap, setTestingImap] = useState(false)\n  const [grabbing, setGrabbing] = useState(false)\n  const [proxyList, setProxyList] = useState<{ url: string; status: string; latencyMs?: number }[]>([])'
  )
}

// Додати функції якщо ще немає
if (!s.includes('const handleGrabProxies')) {
  const beforeReturn = `
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
  s = s.replace(
    '  return (\n    <div>\n      <h1 className="view-title">{t.settingsTitle}</h1>',
    beforeReturn + '  return (\n    <div>\n      <h1 className="view-title">{t.settingsTitle}</h1>'
  )
}

// Додати секцію проксі перед sectionNotify
const proxySection = `
      <div className="settings-section">
        <div className="settings-section__title">Проксі</div>
        <Row label="URL для грабінга" desc="Посилання на сторінку зі списком проксі">
          <input
            className="input"
            style={{ width: 280 }}
            placeholder="https://example.com/proxy-list"
            value={settings.proxy?.grabUrl ?? ''}
            onChange={(e) => void update({ proxy: { ...settings.proxy, grabUrl: e.target.value.trim() } })}
          />
        </Row>
        <Row label="">
          <button className="btn btn--primary btn--sm" onClick={() => void handleGrabProxies()} disabled={grabbing}>
            {grabbing ? 'Граблю…' : 'Grab + Check'}
          </button>
        </Row>
        {proxyList.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <table className="table">
              <thead><tr><th>URL</th><th>Статус</th><th>Lat</th><th></th></tr></thead>
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

if (!s.includes('settings-section__title">Проксі')) {
  s = s.replace(
    '<div className="settings-section">\n        <div className="settings-section__title">{t.sectionNotify}</div>',
    proxySection + '<div className="settings-section">\n        <div className="settings-section__title">{t.sectionNotify}</div>'
  )
}

fs.writeFileSync(f, s)
console.log('ok')
