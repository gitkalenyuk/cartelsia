import { useEffect, useState, useCallback } from 'react'
import {
  UserPlus,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Square,
  KeyRound,
  Globe,
  Play,
  Pause,
  Download,
  Upload,
  Trash2,
  ListChecks,
  Eraser,
  FileUp
} from 'lucide-react'
import { t } from '../../i18n/uk'
import { toast, useKeysStore, useSettingsStore } from '../../stores/appStore'
import { Hint } from '../common/primitives'
import type { AutoregItem, ProxyEntry } from '@shared/types'

function maskProxy(url: string): string {
  return url.replace(/\/\/([^@]+)@/, '//•••@')
}

function stateLabel(state: AutoregItem['state'], hasKey: boolean): string {
  switch (state) {
    case 'queued': return t.autoRegisterStateQueued
    case 'form': return t.autoRegisterStateForm
    case 'waiting-mail': return t.autoRegisterStateWaitingMail
    case 'verifying': return t.autoRegisterStateVerifying
    case 'creating-key': return t.autoRegisterStateCreatingKey
    case 'done': return hasKey ? t.autoRegisterStateDone : t.autoRegisterStateDoneNoKey
    case 'failed': return t.autoRegisterStateFailed
    case 'cancelled': return t.autoRegisterStateCancelled
    default: return state
  }
}

function stateBadgeClass(state: AutoregItem['state'], hasKey: boolean): string {
  switch (state) {
    case 'done': return hasKey ? 'badge--success' : 'badge--warning'
    case 'failed': return 'badge--danger'
    case 'cancelled': return 'badge--neutral'
    case 'queued': return 'badge--neutral'
    default: return 'badge--accent'
  }
}

export function AutoregView(): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const [subTab, setSubTab] = useState<'reg' | 'proxy'>('reg')

  // ── Autoreg state ──
  const [count, setCount] = useState(10)
  const [running, setRunning] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [items, setItems] = useState<AutoregItem[]>([])
  const [lastLog, setLastLog] = useState('')
  const [logLines, setLogLines] = useState<string[]>([])

  const s = settings ?? null
  const threads = Math.max(1, Math.min(25, s?.autoreg?.concurrency ?? 5))
  const useProxy = s?.autoreg?.useProxy ?? false
  const headless = s?.autoreg?.headless ?? true

  useEffect(() => {
    void window.cartelsia.email.getAutoRegStatus().then((s) => {
      if (s.running) { setRunning(true); setItems(s.items) }
      else if (s.items.length) setItems(s.items)
    })
    const off = window.cartelsia.onEvent((event) => {
      if (event.type === 'autoreg-progress') {
        const arr = event.items as AutoregItem[]
        setItems(arr)
        setRunning(true)
        const inFlight = arr.find((x) => x.state === 'form' || x.state === 'waiting-mail' || x.state === 'verifying' || x.state === 'creating-key')
        if (inFlight) setLastLog(`${inFlight.email} → ${stateLabel(inFlight.state, !!inFlight.key)}`)
      } else if (event.type === 'autoreg-item-done') {
        const it = event.item as AutoregItem
        if (it.key) void useKeysStore.getState().load()
      } else if (event.type === 'autoreg-done') {
        const arr = event.items as AutoregItem[]
        setItems(arr)
        setRunning(false)
        setStopping(false)
        const done = arr.filter((x) => x.state === 'done' && x.key).length
        if (done > 0) toast('success', t.autoRegisterDone(done))
        else toast('info', `Завершено: ${done}/${arr.length} з ключами`)
        void useKeysStore.getState().load()
      } else if (event.type === 'autoreg-captcha') {
        toast('info', `Потрібна ручна дія: ${event.email}`)
      } else if (event.type === 'autoreg-log') {
        setLogLines((prev) => [...prev.slice(-199), event.line])
        setLastLog(event.line)
      } else if (event.type === 'proxies-updated') {
        // 2.1.2: realtime-статус проксі під час чекінгу
        setProxies(event.proxies as ProxyEntry[])
      }
    })
    return off
  }, [])

  const start = useCallback(async (): Promise<void> => {
    if (!settings?.catchAllDomain) {
      toast('info', 'Спочатку вкажіть Catch-All домен у Налаштуваннях')
      return
    }
    const target = Math.max(1, count)
    setRunning(true)
    setStopping(false)
    setItems([])
    setLastLog('')
    setLogLines([])

    const res = await window.cartelsia.email.runAutoReg(target, settings.catchAllDomain, settings.imapConfig, {
      concurrency: threads,
      delayMs: settings.autoreg?.delayMs ?? 4000,
      headless,
      useProxy
    })
    if (!res.ok) {
      setRunning(false)
      toast('danger', res.error || 'Не вдалося запустити автореєстрацію')
    }
  }, [settings, count, threads, headless, useProxy])

  const stop = useCallback(async (): Promise<void> => {
    setStopping(true)
    await window.cartelsia.email.stopAutoReg()
  }, [])

  const copy = useCallback(async (text: string): Promise<void> => {
    try { await navigator.clipboard.writeText(text); toast('success', t.autoRegisterCopied) }
    catch { toast('danger', 'Не вдалося скопіювати') }
  }, [])

  const okCount = items.filter((x) => x.state === 'done' && x.key).length
  const partialCount = items.filter((x) => x.state === 'done' && !x.key).length
  const failCount = items.filter((x) => x.state === 'failed').length

  // ── Proxy state ──
  const [proxies, setProxies] = useState<ProxyEntry[]>([])
  const [importText, setImportText] = useState('')
  const [grabUrl, setGrabUrl] = useState('')
  const [checking, setChecking] = useState(false)
  // 2.1.2: налаштування чекінгу (потоки/таймаут) — з settings
  const checkThreads = Math.max(1, Math.min(50, s?.autoreg?.proxyCheckThreads ?? 10))
  const checkTimeout = s?.autoreg?.proxyCheckTimeoutMs ?? 12000
  const emailStyle = s?.autoreg?.emailStyle ?? 'random'
  const emailPrefix = s?.autoreg?.emailPrefix ?? ''

  const loadProxies = useCallback(async (): Promise<void> => {
    setProxies(await window.cartelsia.proxy.list())
  }, [])

  useEffect(() => {
    if (subTab === 'proxy') void loadProxies()
  }, [subTab, loadProxies])

  const doImport = useCallback(async (): Promise<void> => {
    if (!importText.trim()) return
    const r = await window.cartelsia.proxy.importText(importText)
    setImportText('')
    toast('success', t.autoReg2ProxyAdded(r.added))
    void loadProxies()
  }, [importText, loadProxies])

  // 2.1.2: імпорт з файлу через нативний діалог
  const doImportFile = useCallback(async (): Promise<void> => {
    const r = await window.cartelsia.proxy.importFile()
    if (r.added > 0) {
      toast('success', t.autoReg2ProxyAdded(r.added))
      void loadProxies()
    }
  }, [loadProxies])

  const doGrab = useCallback(async (): Promise<void> => {
    if (!grabUrl.trim()) return
    const r = await window.cartelsia.proxy.grab(grabUrl.trim())
    toast('success', t.autoReg2ProxyAdded(r.grabbed))
    void loadProxies()
  }, [grabUrl, loadProxies])

  // 2.1.2: realtime-чек — статуси приходять подіями proxies-updated
  const doCheck = useCallback(async (): Promise<void> => {
    setChecking(true)
    window.cartelsia.proxy.checkStart({ threads: checkThreads, timeoutMs: checkTimeout })
  }, [checkThreads, checkTimeout])

  // Синхронізація кнопки Stop: checking=true поки є 'checking' статуси
  useEffect(() => {
    if (checking && !proxies.some((p) => p.status === 'checking') && proxies.length > 0) {
      const timer = setTimeout(() => {
        setChecking(false)
        void loadProxies()
      }, 800)
      return () => clearTimeout(timer)
    }
  }, [checking, proxies, loadProxies])

  const doCheckStop = useCallback(async (): Promise<void> => {
    await window.cartelsia.proxy.checkStop()
    setChecking(false)
    void loadProxies()
  }, [loadProxies])

  // 2.1.2: експорт проксі у файл
  const doExport = useCallback(async (): Promise<void> => {
    const r = await window.cartelsia.proxy.export(false)
    if (r.path) toast('success', t.fileSaved)
  }, [])

  const removeProxy = useCallback(async (url: string): Promise<void> => {
    const r = await window.cartelsia.proxy.remove(url)
    setProxies(r.proxies)
  }, [])

  const clearDead = useCallback(async (): Promise<void> => {
    const r = await window.cartelsia.proxy.clear(true)
    toast('info', t.autoReg2Removed(r.removed))
    void loadProxies()
  }, [loadProxies])

  const clearAll = useCallback(async (): Promise<void> => {
    const r = await window.cartelsia.proxy.clear(false)
    toast('info', t.autoReg2Removed(r.removed))
    void loadProxies()
  }, [loadProxies])

  const aliveCount = proxies.filter((p) => p.status === 'working').length
  const checkingCount = proxies.filter((p) => p.status === 'checking').length

  return (
    <div className="autoreg2">
      <div className="view-head">
        <div className="view-head__icon"><UserPlus size={20} /></div>
        <div>
          <h1 className="view-title">{t.autoReg2Title}</h1>
          <p className="view-subtitle">{t.autoReg2Subtitle}</p>
        </div>
      </div>

      {/* Підвкладки */}
      <div className="subtabs" role="tablist">
        <button
          className={`subtab ${subTab === 'reg' ? 'subtab--active' : ''}`}
          onClick={() => setSubTab('reg')}
          role="tab"
          aria-selected={subTab === 'reg'}
        >
          <UserPlus size={14} />
          {t.autoReg2TabRegister}
        </button>
        <button
          className={`subtab ${subTab === 'proxy' ? 'subtab--active' : ''}`}
          onClick={() => setSubTab('proxy')}
          role="tab"
          aria-selected={subTab === 'proxy'}
        >
          <Globe size={14} />
          {t.autoReg2TabProxy}
          {useProxy && <span className="subtab__dot" title="проксі увімкнені" />}
        </button>
      </div>

      {subTab === 'reg' && (
        <>
          {/* Панель запуску */}
          <div className="card autoreg2__panel">
            <div className="autoreg2__controls">
              <label className="field">
                <span className="field__label">
                  {t.autoReg2Accounts}
                  <Hint text={t.autoReg2AccountsHint} />
                </span>
                <input
                  className="input tnum"
                  type="number"
                  min={1}
                  max={2000}
                  value={count}
                  onChange={(e) => setCount(Math.max(1, Math.min(2000, Number(e.target.value) || 1)))}
                  disabled={running}
                />
              </label>

              <label className="field">
                <span className="field__label">
                  {t.autoReg2Threads}
                  <Hint text={t.autoReg2ThreadsHint} />
                </span>
                <input
                  className="input tnum"
                  type="number"
                  min={1}
                  max={25}
                  value={threads}
                  onChange={(e) => void useSettingsStore.getState().update({ autoreg: { ...(settings?.autoreg ?? {}), concurrency: Math.max(1, Math.min(25, Number(e.target.value) || 1)) } })}
                  disabled={running}
                />
              </label>

              <label className="field field--check">
                <span className="check">
                  <input
                    type="checkbox"
                    checked={useProxy}
                    onChange={(e) => void useSettingsStore.getState().update({ autoreg: { ...(settings?.autoreg ?? {}), useProxy: e.target.checked } })}
                  />
                  <span className="field__label">{t.autoReg2UseProxy}</span>
                  <Hint text={t.autoReg2UseProxyHint} />
                </span>
              </label>

              <label className="field field--check">
                <span className="check">
                  <input
                    type="checkbox"
                    checked={headless}
                    onChange={(e) => void useSettingsStore.getState().update({ autoreg: { ...(settings?.autoreg ?? {}), headless: e.target.checked } })}
                  />
                  <span className="field__label">{t.autoReg2Headless}</span>
                  <Hint text={t.autoReg2HeadlessHint} />
                </span>
              </label>

              {/* 2.1.2: стиль генерації email */}
              <label className="field">
                <span className="field__label">
                  {t.emailStyle}
                  <Hint text={t.emailStyleHint} />
                </span>
                <select
                  className="input"
                  style={{ width: 180 }}
                  value={emailStyle}
                  disabled={running}
                  onChange={(e) =>
                    void useSettingsStore.getState().update({
                      autoreg: { ...(settings?.autoreg ?? {}), emailStyle: e.target.value as typeof emailStyle }
                    })
                  }
                >
                  <option value="random">{t.emailStyleRandom}</option>
                  <option value="word">{t.emailStyleWord}</option>
                  <option value="support">{t.emailStyleSupport}</option>
                  <option value="custom">{t.emailStyleCustom}</option>
                </select>
              </label>

              {emailStyle === 'custom' && (
                <label className="field">
                  <span className="field__label">
                    {t.emailPrefix}
                    <Hint text={t.emailPrefixHint} />
                  </span>
                  <input
                    className="input"
                    style={{ width: 150 }}
                    placeholder="john"
                    value={emailPrefix}
                    disabled={running}
                    onChange={(e) =>
                      void useSettingsStore.getState().update({
                        autoreg: { ...(settings?.autoreg ?? {}), emailPrefix: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }
                      })
                    }
                  />
                </label>
              )}

              <div className="autoreg2__actions">
                {!running ? (
                  <button className="btn btn--primary" onClick={() => void start()} data-testid="auto-reg-start">
                    <Play size={14} />
                    {t.autoReg2Start}
                  </button>
                ) : (
                  <button className="btn btn--danger" onClick={() => void stop()} disabled={stopping} data-testid="auto-reg-stop">
                    {stopping ? <Loader2 size={14} className="spin" /> : <Square size={14} />}
                    {stopping ? t.autoRegisterStopping : t.autoReg2Stop}
                  </button>
                )}
              </div>
            </div>

            <div className="autoreg2__meta">
              <span><strong>Domain:</strong> <code>{settings?.catchAllDomain || '—'}</code></span>
              <span><strong>IMAP:</strong> <code>{settings?.imapConfig?.host ? `${settings.imapConfig.user}@${settings.imapConfig.host}` : '—'}</code></span>
              <span><strong>Threads:</strong> <code>{threads}</code></span>
              {useProxy && <span><strong>Proxy:</strong> <code>on</code></span>}
            </div>

            {(running || items.length > 0) && (
              <div className="autoreg2__progress-wrap">
                <div className="progress">
                  <div
                    className="progress__fill progress__fill--animated"
                    style={{ width: `${items.length ? Math.round(((okCount + partialCount + failCount) / Math.max(items.length, count)) * 100) : 0}%` }}
                  />
                </div>
                <div className="autoreg2__progress-row">
                  <span className="text-sm muted">{t.autoReg2Progress(okCount, items.length || count, okCount)}</span>
                  {okCount > 0 && (
                    <span className="text-sm" style={{ color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <KeyRound size={12} /> +{okCount} в пулі
                    </span>
                  )}
                  {partialCount > 0 && <span className="text-sm" style={{ color: 'var(--warning)' }}>{partialCount} без ключа</span>}
                  {failCount > 0 && <span className="text-sm" style={{ color: 'var(--danger)' }}>{failCount} фейлів</span>}
                </div>
                {running && lastLog && <div className="autoreg2__lastlog text-sm muted mono">{lastLog}</div>}
                {logLines.length > 0 && (
                  <pre className="autoreg2__log mono" ref={(el) => { if (el) el.scrollTop = el.scrollHeight }}>
                    {logLines.slice(-40).join('\n')}
                  </pre>
                )}
              </div>
            )}
          </div>

          {/* Результати */}
          <div className="card autoreg2__results">
            <div className="autoreg2__results-head">
              <h2>Результати</h2>
              {items.length > 0 && <span className="muted text-sm">{items.length} · {okCount} з ключем</span>}
            </div>
            {items.length === 0 ? (
              <div className="empty">
                <KeyRound size={22} />
                <div className="muted text-sm">{t.autoRegisterNoItems}</div>
              </div>
            ) : (
              <div className="table-wrap--scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t.autoRegisterTableEmail}</th>
                      <th>{t.autoRegisterTableStatus}</th>
                      <th>{t.autoRegisterTableKey}</th>
                      <th>{t.autoRegisterTableError}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => (
                      <tr key={it.id} className={it.state === 'failed' ? 'is-dimmed autoreg2__row' : 'autoreg2__row'}>
                        <td>
                          <span className="mono text-sm">{it.email}</span>
                          <button className="iconbtn" onClick={() => void copy(it.email)} title="Копіювати пошту">
                            <Copy size={12} />
                          </button>
                        </td>
                        <td>
                          <span className={`badge ${stateBadgeClass(it.state, !!it.key)}`}>
                            {(it.state === 'form' || it.state === 'waiting-mail' || it.state === 'verifying' || it.state === 'creating-key') && <Loader2 size={10} className="spin" />}
                            {it.state === 'done' && !!it.key && <CheckCircle2 size={10} />}
                            {it.state === 'failed' && <AlertTriangle size={10} />}
                            {stateLabel(it.state, !!it.key)}
                          </span>
                        </td>
                        <td>
                          {it.key ? (
                            <span className="mono text-sm autoreg2__key">
                              {it.key.slice(0, 14)}…{it.key.slice(-4)}
                              <button className="iconbtn" onClick={() => void copy(it.key!)} title="Копіювати ключ">
                                <Copy size={12} />
                              </button>
                            </span>
                          ) : (
                            <span className="muted text-sm">—</span>
                          )}
                        </td>
                        <td className="text-sm autoreg2__error" title={it.error}>
                          {it.error || <span className="muted">—</span>}
                        </td>
                        <td>
                          <button className="iconbtn" title="Копіювати пароль" onClick={() => void copy(it.pass)}>
                            <Copy size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {subTab === 'proxy' && (
        <>
          <div className="card autoreg2__proxy-panel">
            <div className="autoreg2__proxy-head">
              <h2>{t.autoReg2ProxyTitle}</h2>
              <span className="muted text-sm">{t.autoReg2ProxyStats(proxies.length, aliveCount)}</span>
              <Hint text={t.autoReg2ProxyHint} />
            </div>

            <div className="autoreg2__proxy-import">
              <textarea
                className="input autoreg2__proxy-textarea"
                placeholder={'ip:port:user:pass\nhttp://user:pass@ip:port\nip:port\nsocks5://ip:port'}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={5}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button className="btn btn--primary btn--sm" onClick={() => void doImport()} disabled={!importText.trim()}>
                  <Download size={13} />
                  {t.autoReg2ProxyImport}
                </button>
                {/* 2.1.2: імпорт з файлу */}
                <button className="btn btn--secondary btn--sm" onClick={() => void doImportFile()}>
                  <FileUp size={13} />
                  {t.proxyImportFile}
                </button>
              </div>
            </div>

            <div className="autoreg2__proxy-grab">
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder="https://.../proxies.txt (грабінг списку звідти)"
                value={grabUrl}
                onChange={(e) => setGrabUrl(e.target.value)}
              />
              <button className="btn btn--secondary btn--sm" onClick={() => void doGrab()} disabled={!grabUrl.trim()}>
                <Globe size={13} />
                Grab URL
              </button>
            </div>

            {/* 2.1.2: потоки і таймаут чекінгу */}
            <div className="row" style={{ gap: 12, alignItems: 'flex-end', marginTop: 10 }}>
              <label className="field">
                <span className="field__label">
                  {t.proxyCheckThreads}
                  <Hint text={t.proxyCheckThreadsHint} />
                </span>
                <input
                  className="input tnum"
                  type="number"
                  min={1}
                  max={50}
                  style={{ width: 80 }}
                  value={checkThreads}
                  disabled={checking}
                  onChange={(e) =>
                    void useSettingsStore.getState().update({
                      autoreg: { ...(settings?.autoreg ?? {}), proxyCheckThreads: Math.max(1, Math.min(50, Number(e.target.value) || 10)) }
                    })
                  }
                />
              </label>
              <label className="field">
                <span className="field__label">
                  {t.proxyCheckTimeout}
                  <Hint text={t.proxyCheckTimeoutHint} />
                </span>
                <input
                  className="input tnum"
                  type="number"
                  min={3000}
                  max={60000}
                  step={1000}
                  style={{ width: 100 }}
                  value={checkTimeout}
                  disabled={checking}
                  onChange={(e) =>
                    void useSettingsStore.getState().update({
                      autoreg: { ...(settings?.autoreg ?? {}), proxyCheckTimeoutMs: Math.max(3000, Math.min(60000, Number(e.target.value) || 12000)) }
                    })
                  }
                />
              </label>
              <span className="muted text-sm">
                {checking && checkingCount > 0 ? t.proxyCheckingNow(checkingCount) : ''}
              </span>
            </div>

            <div className="autoreg2__proxy-actions">
              {!checking ? (
                <button className="btn btn--secondary btn--sm" onClick={() => void doCheck()} disabled={proxies.length === 0}>
                  <ListChecks size={13} />
                  {t.autoReg2ProxyCheck}
                </button>
              ) : (
                <button className="btn btn--danger btn--sm" onClick={() => void doCheckStop()}>
                  <Pause size={13} />
                  {t.proxyCheckStop}
                </button>
              )}
              <button className="btn btn--secondary btn--sm" onClick={() => void doExport()} disabled={proxies.length === 0}>
                <Upload size={13} />
                {t.proxyExport}
              </button>
              <button className="btn btn--secondary btn--sm" onClick={() => void clearDead()} disabled={checking}>
                <Eraser size={13} />
                {t.autoReg2ProxyClearDead}
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => void clearAll()} disabled={checking || proxies.length === 0}>
                <Trash2 size={13} />
                {t.autoReg2ProxyClearAll}
              </button>
            </div>
          </div>

          <div className="card">
            {proxies.length === 0 ? (
              <div className="empty">
                <Globe size={22} />
                <div className="muted text-sm">{t.autoReg2ProxyEmpty}</div>
              </div>
            ) : (
              <div className="table-wrap--scroll" style={{ maxHeight: 420 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>URL</th>
                      <th>Статус</th>
                      <th>Затримка</th>
                      <th>Перевірено</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {proxies.map((p) => (
                      <tr key={p.url} className="autoreg2__row">
                        <td className="mono text-sm">{maskProxy(p.url)}</td>
                        <td>
                          <span className={`badge ${p.status === 'working' ? 'badge--success' : p.status === 'dead' ? 'badge--danger' : p.status === 'checking' ? 'badge--accent' : 'badge--neutral'}`}>
                            {p.status === 'working' && <CheckCircle2 size={10} />}
                            {p.status === 'checking' && <Loader2 size={10} className="spin" />}
                            {p.status === 'working' ? t.proxyStatusWorking : p.status === 'dead' ? t.proxyStatusDead : p.status === 'checking' ? t.proxyStatusChecking : t.proxyStatusUnchecked}
                          </span>
                        </td>
                        <td className="text-sm tnum">{p.latencyMs != null ? `${p.latencyMs} мс` : '—'}</td>
                        <td className="text-sm muted">{p.lastChecked ? new Date(p.lastChecked).toLocaleTimeString() : '—'}</td>
                        <td>
                          <button className="iconbtn" title="Видалити" onClick={() => void removeProxy(p.url)}>
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
