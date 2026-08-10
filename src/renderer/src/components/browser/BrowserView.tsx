import { useEffect, useState, useCallback } from 'react'
import {
  UserPlus,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ExternalLink as ExtIcon,
  Copy,
  Square,
  KeyRound
} from 'lucide-react'
import { t } from '../../i18n/uk'
import { toast, useKeysStore, useSettingsStore } from '../../stores/appStore'
import type { AutoregItem } from '@shared/types'

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

export function BrowserView(): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const [targetCount, setTargetCount] = useState(2)
  const [running, setRunning] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [items, setItems] = useState<AutoregItem[]>([])
  const [current, setCurrent] = useState(0)
  const [total, setTotal] = useState(0)
  const [captchaEmail, setCaptchaEmail] = useState<string | null>(null)
  const [captchaMessage, setCaptchaMessage] = useState('')

  // Підписка на потокові події з main
  useEffect(() => {
    // Відновити стан якщо джоб уже запущений (наприклад після перемикання вкладок)
    void window.cartelsia.email.getAutoRegStatus().then((s) => {
      if (s.running) {
        setRunning(true)
        setItems(s.items)
      } else if (s.items.length) {
        setItems(s.items)
      }
    })

    const off = window.cartelsia.onEvent((event) => {
      if (event.type === 'autoreg-progress') {
        setItems(event.items as AutoregItem[])
        setCurrent(event.current)
        setTotal(event.total)
        setRunning(true)
      } else if (event.type === 'autoreg-item-done') {
        const it = event.item as AutoregItem
        if (it.key) void useKeysStore.getState().load()
      } else if (event.type === 'autoreg-done') {
        setItems(event.items as AutoregItem[])
        setRunning(false)
        setStopping(false)
        const done = (event.items as AutoregItem[]).filter((x) => x.state === 'done' && x.key).length
        const totalDone = (event.items as AutoregItem[]).length
        if (done > 0) toast('success', t.autoRegisterDone(done))
        else if (totalDone > 0) toast('info', `Завершено: ${done}/${totalDone} з ключами`)
        void useKeysStore.getState().load()
      } else if (event.type === 'autoreg-captcha') {
        setCaptchaEmail(event.email)
        setCaptchaMessage(event.message)
      }
    })
    return off
  }, [])

  const continueCaptcha = useCallback(async () => {
    await window.cartelsia.email.runAutoRegContinue()
    setCaptchaEmail(null)
    setCaptchaMessage('')
  }, [])

  const cancelCaptcha = useCallback(async () => {
    await window.cartelsia.email.runAutoRegCancel()
    setCaptchaEmail(null)
    setCaptchaMessage('')
  }, [])

  const startAutoRegistration = async (): Promise<void> => {
    if (!settings?.catchAllDomain) {
      toast('info', 'Спочатку вкажіть ваш Catch-All домен у Налаштуваннях')
      return
    }
    const target = Math.max(1, Math.min(50, targetCount))
    setRunning(true)
    setStopping(false)
    setCaptchaEmail(null)
    setItems([])
    setCurrent(0)
    setTotal(target)

    const delayMs = settings.autoreg?.delayMs ?? undefined
    const captchaProvider = (settings.autoreg?.captchaProvider ?? 'manual') as never
    const captchaApiKey = settings.autoreg?.captchaApiKey

    const res = await window.cartelsia.email.runAutoReg(
      target,
      settings.catchAllDomain,
      settings.imapConfig,
      { captchaProvider, captchaApiKey, delayMs }
    )
    if (!res.ok) {
      setRunning(false)
      toast('danger', res.error || 'Не вдалося запустити автореєстрацію')
    }
    // Успіх — прогрес прийде через autoreg-progress / autoreg-done
  }

  const handleStop = async (): Promise<void> => {
    setStopping(true)
    await window.cartelsia.email.stopAutoReg()
  }

  const handleCopy = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      toast('success', t.autoRegisterCopied)
    } catch {
      toast('danger', 'Не вдалося скопіювати')
    }
  }

  const openInSystemChrome = (): void => {
    window.cartelsia.audio.reveal('C:\\Windows\\SystemApps').catch(() => {})
    window.open('https://play.cartesia.ai/sign-in/create', '_blank')
  }

  const doneWithKey = items.filter((x) => x.state === 'done' && x.key).length

  return (
    <div className="auto-reg">
      <div className="auto-reg__header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <UserPlus size={20} style={{ color: 'var(--accent)' }} />
        <h1 className="view-title" style={{ margin: 0 }}>{t.autoRegisterTitle}</h1>
      </div>

      <div className="card auto-reg__config" style={{ marginTop: 16 }}>
        <p className="muted text-sm" style={{ marginTop: 0 }}>
          Cartelsia відкриває окреме вікно <strong>Chromium</strong> через Playwright (без вбудованого webview, який блокується Cloudflare).
          У реальному браузері капча Turnstile проходить нормально — підтвердіть її вручну або увімкніть автосолвінг у Налаштуваннях.
          Усі ключі автоматично додаються в пул і записуються у файл <span className="mono">data/accounts.txt</span>.
        </p>

        <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
          <div className="row" style={{ gap: 6, alignItems: 'center' }}>
            <span className="text-sm muted">{t.autoRegisterCountLabel}</span>
            <input
              className="input tnum"
              style={{ width: 80 }}
              type="number"
              min={1}
              max={50}
              value={targetCount}
              onChange={(e) => setTargetCount(Math.max(1, Number(e.target.value) || 1))}
              disabled={running}
              data-testid="auto-reg-count"
            />
            <span className="muted text-sm" style={{ fontSize: 11 }}>{t.autoregCountHint}</span>
          </div>

          {!running ? (
            <button
              className="btn btn--primary btn--sm"
              onClick={() => void startAutoRegistration()}
              data-testid="auto-reg-start"
            >
              <UserPlus size={13} />
              {t.autoRegisterStart(targetCount)}
            </button>
          ) : (
            <button
              className="btn btn--danger btn--sm"
              onClick={() => void handleStop()}
              disabled={stopping}
              data-testid="auto-reg-stop"
            >
              {stopping ? <Loader2 size={13} className="spin" /> : <Square size={13} />}
              {stopping ? t.autoRegisterStopping : t.autoRegisterStop}
            </button>
          )}

          <button
            className="btn btn--secondary btn--sm"
            onClick={openInSystemChrome}
            data-testid="open-system-chrome"
          >
            <ExtIcon size={13} />
            {t.browserOpenExternal}
          </button>
        </div>

        <div className="muted text-sm" style={{ marginTop: 10, fontSize: 12 }}>
          <strong>Domain:</strong> <span className="mono">{settings?.catchAllDomain || '(не вказано)'}</span>{' '}
          · <strong>IMAP:</strong>{' '}
          <span className="mono">
            {settings?.imapConfig?.host
              ? `${settings.imapConfig.user}@${settings.imapConfig.host}`
              : '(не налаштовано)'}
          </span>
          {settings?.autoreg?.captchaProvider && settings.autoreg.captchaProvider !== 'manual' && (
            <> · <strong>Captcha:</strong> <span className="mono">{settings.autoreg.captchaProvider}</span></>
          )}
        </div>

        {running && total > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="progress" style={{ height: 6 }}>
              <div className="progress__fill" style={{ width: `${Math.round((current / total) * 100)}%` }} />
            </div>
            <div className="muted text-sm" style={{ marginTop: 4, fontSize: 12 }}>
              {t.autoRegisterProgress(current, total)}
              {doneWithKey > 0 && <> · <span style={{ color: 'var(--success)' }}><KeyRound size={11} style={{ display: 'inline', verticalAlign: -1 }} /> +{doneWithKey} ключів у пулі</span></>}
            </div>
          </div>
        )}
      </div>

      {captchaEmail && (
        <div
          className="card"
          style={{ marginTop: 16, border: '1px solid var(--accent-border)', background: 'var(--accent-muted)' }}
          data-testid="captcha-banner"
        >
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <AlertTriangle size={18} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{t.autoRegisterCaptchaTitle(captchaEmail)}</div>
              <div className="muted text-sm" style={{ marginTop: 4 }}>{captchaMessage || t.autoRegisterCaptchaBody}</div>
              <div className="row" style={{ gap: 8, marginTop: 12 }}>
                <button className="btn btn--primary btn--sm" onClick={() => void continueCaptcha()} data-testid="captcha-continue">
                  <CheckCircle2 size={13} />{t.autoRegisterCaptchaContinue}
                </button>
                <button className="btn btn--secondary btn--sm" onClick={() => void cancelCaptcha()} data-testid="captcha-cancel">
                  {t.autoRegisterCaptchaCancel}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 14 }}>Результати</h2>
          {items.length > 0 && (
            <span className="muted text-sm">{items.length} · {doneWithKey} з ключем</span>
          )}
        </div>

        {items.length === 0 ? (
          <div className="empty" style={{ padding: '20px 12px' }}>
            <KeyRound size={22} style={{ opacity: 0.4 }} />
            <div className="muted text-sm">{t.autoRegisterNoItems}</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t.autoRegisterTableEmail}</th>
                  <th>{t.autoRegisterTableStatus}</th>
                  <th>{t.autoRegisterTableKey}</th>
                  <th>{t.autoRegisterTableError}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={it.id} className={it.state === 'failed' ? 'is-dimmed' : undefined}>
                    <td className="mono text-sm muted">{idx + 1}</td>
                    <td>
                      <span className="mono text-sm" style={{ fontSize: 12 }}>{it.email}</span>
                      <button className="iconbtn" style={{ width: 22, height: 22, marginLeft: 4, verticalAlign: 'middle' }} onClick={() => void handleCopy(it.email)} title="Копіювати пошту">
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
                        <span className="mono text-sm" style={{ fontSize: 12 }}>
                          {it.key.slice(0, 14)}…{it.key.slice(-4)}
                          <button className="iconbtn" style={{ width: 22, height: 22, marginLeft: 4, verticalAlign: 'middle' }} onClick={() => void handleCopy(it.key!)} title="Копіювати ключ">
                            <Copy size={12} />
                          </button>
                        </span>
                      ) : (
                        <span className="muted text-sm">—</span>
                      )}
                    </td>
                    <td className="text-sm" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: it.state === 'failed' ? 'var(--danger)' : undefined }} title={it.error}>
                      {it.error || <span className="muted">—</span>}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 2 }}>
                        <button className="iconbtn" title="Копіювати пароль" onClick={() => void handleCopy(it.pass)}>
                          <Copy size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
