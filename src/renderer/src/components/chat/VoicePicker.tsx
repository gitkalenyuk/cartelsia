import { useEffect, useRef, useState } from 'react'
import { AudioLines, Check, Pause, Play, Star } from 'lucide-react'
import type { CartesiaVoice } from '@shared/types'
import { t, langLabel } from '../../i18n/uk'
import { useKeysStore, useVoicesLocalStore } from '../../stores/appStore'
import { useSamplePlayer } from '../../audio/samplePlayer'

/**
 * Пілюля вибору голосу: popover зі списком (вибране → клони → бібліотека),
 * пошук, фільтр за мовою композера (перемикач), семпл на КОЖНОМУ голосі
 * (оригінальний або згенерований main-процесом).
 */
export function VoicePicker(props: {
  value: string
  valueName?: string
  filterLanguage?: string
  onChange: (voice: { id: string; name: string; owningKeyId?: string }) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [langOnly, setLangOnly] = useState(true)
  const [voices, setVoices] = useState<CartesiaVoice[]>([])
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const favorites = useVoicesLocalStore((s) => s.favorites)
  const clones = useVoicesLocalStore((s) => s.clones)
  const keys = useKeysStore((s) => s.keys)
  const playingVoiceId = useSamplePlayer((s) => s.playingVoiceId)
  const loadingVoiceId = useSamplePlayer((s) => s.loadingVoiceId)

  const effectiveLang = langOnly && props.filterLanguage ? props.filterLanguage : undefined

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (!open || !keys.length) return
    const timer = setTimeout(() => {
      setLoading(true)
      window.cartelsia.voices
        .list({ q: query || undefined, language: effectiveLang })
        .then((res) => setVoices(res.data))
        .catch(() => setVoices([]))
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, effectiveLang, keys.length])

  const q = query.toLowerCase()
  const matches = (name: string, lang: string): boolean =>
    (!q || name.toLowerCase().includes(q)) && (!effectiveLang || lang === effectiveLang)
  const favIds = new Set(favorites.map((f) => f.id))
  const cloneIds = new Set(clones.map((c) => c.id))
  const favList = favorites.filter((f) => matches(f.name, f.language))
  const cloneList = clones.filter((c) => matches(c.name, c.language))
  const rest = voices.filter((v) => !favIds.has(v.id) && !cloneIds.has(v.id))

  const select = (id: string, name: string): void => {
    const owningKeyId = clones.find((c) => c.id === id)?.owningKeyId
    props.onChange({ id, name, owningKeyId })
    setOpen(false)
  }

  const renderRow = (
    id: string,
    name: string,
    lang: string,
    previewUrl?: string,
    badge?: string
  ): React.JSX.Element => (
    <div key={id} className={`popover__item${id === props.value ? ' is-selected' : ''}`}
      style={{ cursor: 'pointer' }} onClick={() => select(id, name)}>
      {id === props.value ? <Check size={14} /> : <AudioLines size={14} />}
      <span className="grow">
        {name}
        <span className="muted text-sm" style={{ display: 'block' }}>
          {langLabel(lang)}
          {badge ? ` · ${badge}` : ''}
        </span>
      </span>
      {favIds.has(id) ? <Star size={12} style={{ color: 'var(--warning)' }} /> : null}
      <span
        className="iconbtn"
        style={{ width: 24, height: 24 }}
        title={t.listen}
        onClick={(e) => {
          e.stopPropagation()
          void useSamplePlayer
            .getState()
            .toggle({ id, previewUrl }, effectiveLang ?? props.filterLanguage ?? lang)
        }}
      >
        {loadingVoiceId === id ? (
          <span className="spinner" style={{ width: 11, height: 11 }} />
        ) : playingVoiceId === id ? (
          <Pause size={13} />
        ) : (
          <Play size={13} />
        )}
      </span>
    </div>
  )

  return (
    <div className="popover-anchor" ref={ref}>
      <button className="pill" onClick={() => setOpen((v) => !v)} data-testid="voice-picker">
        <AudioLines size={13} />
        {t.voice}:{' '}
        <span className="pill__value">{props.valueName || t.noVoiceSelected}</span>
      </button>
      {open ? (
        <div className="popover" style={{ minWidth: 320 }}>
          <div className="popover__search">
            <input
              className="input"
              autoFocus
              placeholder={t.searchVoices}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {props.filterLanguage ? (
              <label className="row" style={{ marginTop: 8, cursor: 'pointer', fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>
                <span
                  className={`toggle${langOnly ? ' is-on' : ''}`}
                  onClick={(e) => {
                    e.preventDefault()
                    setLangOnly((v) => !v)
                  }}
                />
                {t.onlyLanguage(langLabel(props.filterLanguage))}
              </label>
            ) : null}
          </div>
          <div className="popover__list" style={{ maxHeight: 340 }}>
            {favList.length ? (
              <div className="sidebar__section" style={{ padding: '4px 10px' }}>{t.favorites}</div>
            ) : null}
            {favList.map((f) => renderRow(f.id, f.name, f.language, f.previewUrl))}
            {cloneList.length ? (
              <div className="sidebar__section" style={{ padding: '4px 10px' }}>{t.myClones}</div>
            ) : null}
            {cloneList.map((c) =>
              renderRow(c.id, c.name, c.language, undefined, `${t.cloneBadge} · ${c.owningKeyLabel}`)
            )}
            {rest.length ? (
              <div className="sidebar__section" style={{ padding: '4px 10px' }}>{t.voices}</div>
            ) : null}
            {rest.map((v) => renderRow(v.id, v.name, v.language, v.previewUrl))}
            {loading ? (
              <div className="row" style={{ padding: 10, justifyContent: 'center' }}>
                <span className="spinner" />
              </div>
            ) : null}
            {!loading && !favList.length && !cloneList.length && !rest.length ? (
              <div className="muted text-sm" style={{ padding: 10 }}>
                {keys.length ? t.voicesNotFound : t.addKeysHint}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
