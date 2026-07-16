import { createElement, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  KeyRound,
  Mail,
  RotateCw,
  Sparkles
} from 'lucide-react'
import { extractCartesiaKeys } from '@shared/keyUtils'
import { t } from '../../i18n/uk'
import { toast, useKeysStore } from '../../stores/appStore'
import { IconButton, Toggle } from '../common/primitives'

// Стандартний Chrome-UA — Google інколи блокує вхід у «нестандартних» вбудованих браузерах
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
const PARTITION = 'persist:cartelsia-web'

interface Webview extends HTMLElement {
  loadURL(url: string): Promise<void>
  reload(): void
  goBack(): void
  goForward(): void
  getURL(): string
  executeJavaScript(code: string): Promise<unknown>
}

function normalizeUrl(input: string): string {
  const v = input.trim()
  if (!v) return v
  if (/^[a-z]+:\/\//i.test(v) || v.startsWith('data:')) return v
  if (/^[\w-]+(\.[\w-]+)+/.test(v)) return `https://${v}`
  return `https://www.google.com/search?q=${encodeURIComponent(v)}`
}

function Pane(props: {
  initialUrl: string
  presets: { label: string; url: string; icon: React.ReactNode }[]
  grab?: boolean
  testId: string
}): React.JSX.Element {
  const ref = useRef<Webview | null>(null)
  const [url, setUrl] = useState(props.initialUrl)
  const [editing, setEditing] = useState(props.initialUrl)
  const [loading, setLoading] = useState(false)
  const [asClone, setAsClone] = useState(false)

  useEffect(() => {
    const wv = ref.current
    if (!wv) return
    const onNav = (e: Event): void => {
      const u = (e as unknown as { url?: string }).url
      if (u) {
        setUrl(u)
        setEditing(u)
      }
    }
    const onStart = (): void => setLoading(true)
    const onStop = (): void => setLoading(false)
    wv.addEventListener('did-navigate', onNav)
    wv.addEventListener('did-navigate-in-page', onNav)
    wv.addEventListener('did-start-loading', onStart)
    wv.addEventListener('did-stop-loading', onStop)
    // OAuth-попапи вантажимо в тій же панелі
    const onNew = (e: Event): void => {
      const u = (e as unknown as { url?: string }).url
      if (u) void ref.current?.loadURL(u)
    }
    wv.addEventListener('new-window', onNew)
    return () => {
      wv.removeEventListener('did-navigate', onNav)
      wv.removeEventListener('did-navigate-in-page', onNav)
      wv.removeEventListener('did-start-loading', onStart)
      wv.removeEventListener('did-stop-loading', onStop)
      wv.removeEventListener('new-window', onNew)
    }
  }, [])

  const go = (u: string): void => {
    const norm = normalizeUrl(u)
    setEditing(norm)
    void ref.current?.loadURL(norm)
  }

  const grabKey = async (): Promise<void> => {
    const wv = ref.current
    if (!wv) return
    try {
      const body = (await wv.executeJavaScript(
        'document.body ? document.body.innerText : ""'
      )) as string
      const fields = (await wv.executeJavaScript(
        'Array.from(document.querySelectorAll("input,textarea,code,pre")).map(function(e){return e.value||e.textContent||""}).join("\\n")'
      )) as string
      const keys = extractCartesiaKeys(`${body}\n${fields}`)
      if (!keys.length) {
        toast('info', t.browserNoKey)
        return
      }
      const res = await window.cartelsia.keys.add(keys, undefined, asClone ? 'clone' : 'pool')
      await useKeysStore.getState().load()
      if (res.added.length) toast('success', t.browserGrabbed(res.added.length))
      else toast('info', t.browserNoKey)
    } catch (err) {
      toast('danger', t.errorPrefix(err instanceof Error ? err.message : String(err)))
    }
  }

  return (
    <div className="bpane" data-testid={props.testId}>
      <div className="bpane__bar">
        <IconButton icon={<ArrowLeft size={15} />} label={t.browserBack} onClick={() => ref.current?.goBack()} />
        <IconButton icon={<ArrowRight size={15} />} label={t.browserForward} onClick={() => ref.current?.goForward()} />
        <IconButton
          icon={<RotateCw size={14} className={loading ? 'spin' : ''} />}
          label={t.browserReload}
          onClick={() => ref.current?.reload()}
        />
        <input
          className="input bpane__url"
          value={editing}
          onChange={(e) => setEditing(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go(editing)}
          spellCheck={false}
        />
        {props.presets.map((p) => (
          <button key={p.label} className="pill" onClick={() => go(p.url)} title={p.url}>
            {p.icon}
            {p.label}
          </button>
        ))}
      </div>
      {props.grab ? (
        <div className="bpane__grab">
          <button className="btn btn--primary btn--sm" onClick={() => void grabKey()} data-testid="grab-key">
            <KeyRound size={13} />
            {t.browserGrabKey}
          </button>
          <label className="row text-sm muted" style={{ cursor: 'pointer', gap: 6 }}>
            <Toggle checked={asClone} onChange={setAsClone} />
            {t.browserAsClone}
          </label>
        </div>
      ) : null}
      {createElement('webview', {
        ref: (el: HTMLElement | null) => {
          ref.current = el as Webview | null
        },
        src: props.initialUrl,
        partition: PARTITION,
        allowpopups: 'true',
        useragent: UA,
        style: { flex: 1, width: '100%', border: 'none' }
      } as Record<string, unknown>)}
    </div>
  )
}

const MAIL_URL = 'https://mail.google.com'
const CARTESIA_URL = 'https://play.cartesia.ai/keys'

export function BrowserView(): React.JSX.Element {
  // у тестах не вантажимо важкі зовнішні сайти (швидке закриття)
  const e2e = window.cartelsia.env?.e2e
  return (
    <div className="browser-view">
      <div className="browser-hint">
        <Sparkles size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <div>
          {t.browserHint}
          <div className="muted text-sm" style={{ marginTop: 4 }}>
            {t.browserGoogleNote}
          </div>
        </div>
      </div>
      <div className="browser-panes">
        <Pane
          testId="pane-mail"
          initialUrl={e2e ? 'about:blank' : MAIL_URL}
          presets={[{ label: t.browserGmail, url: MAIL_URL, icon: <Mail size={13} /> }]}
        />
        <Pane
          testId="pane-cartesia"
          initialUrl={e2e ? 'about:blank' : CARTESIA_URL}
          grab
          presets={[{ label: t.browserCartesia, url: CARTESIA_URL, icon: <KeyRound size={13} /> }]}
        />
      </div>
    </div>
  )
}
