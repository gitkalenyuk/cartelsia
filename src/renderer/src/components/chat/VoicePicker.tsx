import { useEffect, useRef, useState } from 'react'
import { AudioLines, Check, Pause, Play, Star } from 'lucide-react'
import type { CartesiaVoice } from '@shared/types'
import { t, LANGUAGE_NAMES } from '../../i18n/uk'
import { useKeysStore, useVoicesLocalStore } from '../../stores/appStore'
import { previewUrl, usePlayerStore } from '../../stores/playerStore'

/**
 * Пілюля вибору голосу: popover зі списком (вибране зверху, потім клони, потім бібліотека),
 * пошук, превʼю-програвання.
 */
export function VoicePicker(props: {
  value: string
  valueName?: string
  onChange: (voice: { id: string; name: string; owningKeyId?: string }) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [voices, setVoices] = useState<CartesiaVoice[]>([])
  const [loading, setLoading] = useState(false)
  const [previewPlaying, setPreviewPlaying] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const favorites = useVoicesLocalStore((s) => s.favorites)
  const clones = useVoicesLocalStore((s) => s.clones)
  const keys = useKeysStore((s) => s.keys)
  const previewAudio = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (!open || voices.length || !keys.length) return
    setLoading(true)
    window.cartelsia.voices
      .list({ q: query || undefined })
      .then((res) => setVoices(res.data))
      .catch(() => setVoices([]))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      setLoading(true)
      window.cartelsia.voices
        .list({ q: query || undefined })
        .then((res) => setVoices(res.data))
        .catch(() => undefined)
        .finally(() => setLoading(false))
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const togglePreview = (voice: CartesiaVoice): void => {
    if (!voice.previewUrl) return
    if (previewPlaying === voice.id) {
      previewAudio.current?.pause()
      setPreviewPlaying(null)
      return
    }
    usePlayerStore.getState().stop()
    previewAudio.current?.pause()
    const audio = new Audio(previewUrl(voice.previewUrl))
    previewAudio.current = audio
    audio.onended = () => setPreviewPlaying(null)
    void audio.play().catch(() => setPreviewPlaying(null))
    setPreviewPlaying(voice.id)
  }

  const q = query.toLowerCase()
  const matches = (name: string): boolean => !q || name.toLowerCase().includes(q)
  const favIds = new Set(favorites.map((f) => f.id))
  const cloneIds = new Set(clones.map((c) => c.id))
  const favList = favorites.filter((f) => matches(f.name))
  const cloneList = clones.filter((c) => matches(c.name))
  const rest = voices.filter((v) => !favIds.has(v.id) && !cloneIds.has(v.id) && matches(v.name))

  const select = (id: string, name: string): void => {
    const owningKeyId = clones.find((c) => c.id === id)?.owningKeyId
    props.onChange({ id, name, owningKeyId })
    setOpen(false)
  }

  const renderRow = (
    id: string,
    name: string,
    lang: string,
    prev?: string,
    badge?: string
  ): React.JSX.Element => (
    <button key={id} className={`popover__item${id === props.value ? ' is-selected' : ''}`} onClick={() => select(id, name)}>
      {id === props.value ? <Check size={14} /> : <AudioLines size={14} />}
      <span className="grow">
        {name}
        <span className="muted text-sm" style={{ display: 'block' }}>
          {LANGUAGE_NAMES[lang] ?? lang}
          {badge ? ` · ${badge}` : ''}
        </span>
      </span>
      {favIds.has(id) ? <Star size={12} style={{ color: 'var(--warning)' }} /> : null}
      {prev ? (
        <span
          className="iconbtn"
          style={{ width: 24, height: 24 }}
          onClick={(e) => {
            e.stopPropagation()
            togglePreview({ id, name, language: lang, previewUrl: prev, isOwner: false, isPublic: true })
          }}
        >
          {previewPlaying === id ? <Pause size={13} /> : <Play size={13} />}
        </span>
      ) : null}
    </button>
  )

  return (
    <div className="popover-anchor" ref={ref}>
      <button className="pill" onClick={() => setOpen((v) => !v)} data-testid="voice-picker">
        <AudioLines size={13} />
        {t.voice}:{' '}
        <span className="pill__value">{props.valueName || t.noVoiceSelected}</span>
      </button>
      {open ? (
        <div className="popover" style={{ minWidth: 300 }}>
          <div className="popover__search">
            <input
              className="input"
              autoFocus
              placeholder={t.searchVoices}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
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
