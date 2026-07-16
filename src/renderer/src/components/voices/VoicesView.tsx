import { useCallback, useEffect, useState } from 'react'
import {
  AudioLines,
  Globe2,
  Mic,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Star,
  Trash2
} from 'lucide-react'
import type { CartesiaVoice } from '@shared/types'
import { SUPPORTED_LANGUAGES } from '@shared/types'
import { t, langLabel } from '../../i18n/uk'
import { toast, useKeysStore, useUiStore, useVoicesLocalStore } from '../../stores/appStore'
import { useSamplePlayer } from '../../audio/samplePlayer'
import {
  Badge,
  Button,
  ConfirmDialog,
  Dropdown,
  EmptyState,
  IconButton,
  Modal
} from '../common/primitives'

const AVATAR_COLORS = ['#d97757', '#8aa9c9', '#7fa66f', '#d4a027', '#b58bc9', '#6fb8ad']

function avatarColor(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

export function VoicesView(): React.JSX.Element {
  const keys = useKeysStore((s) => s.keys)
  const favorites = useVoicesLocalStore((s) => s.favorites)
  const clones = useVoicesLocalStore((s) => s.clones)
  const [voices, setVoices] = useState<CartesiaVoice[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [lang, setLang] = useState('')
  const [gender, setGender] = useState('')
  const [favOnly, setFavOnly] = useState(false)
  const [clonesOnly, setClonesOnly] = useState(false)
  const [localizeVoice, setLocalizeVoice] = useState<CartesiaVoice | null>(null)
  const [deleteVoice, setDeleteVoice] = useState<CartesiaVoice | null>(null)
  const playingVoiceId = useSamplePlayer((s) => s.playingVoiceId)
  const loadingVoiceId = useSamplePlayer((s) => s.loadingVoiceId)

  const load = useCallback(
    (append = false, cur?: string) => {
      if (!keys.length) return
      setLoading(true)
      window.cartelsia.voices
        .list({
          q: query || undefined,
          language: lang || undefined,
          gender: gender || undefined,
          cursor: append ? cur : undefined
        })
        .then((res) => {
          setVoices((prev) => (append ? [...prev, ...res.data] : res.data))
          setHasMore(res.hasMore)
          setCursor(res.nextCursor)
        })
        .catch((err) => toast('danger', t.errorPrefix(err.message ?? String(err))))
        .finally(() => setLoading(false))
    },
    [keys.length, query, lang, gender]
  )

  useEffect(() => {
    const timer = setTimeout(() => load(false), 300)
    return () => clearTimeout(timer)
  }, [load])

  const favIds = new Set(favorites.map((f) => f.id))
  const cloneById = new Map(clones.map((c) => [c.id, c]))

  let list: CartesiaVoice[] = voices
  if (clonesOnly) {
    list = clones.map((c) => ({
      id: c.id,
      name: c.name,
      language: c.language,
      description: c.description,
      isOwner: true,
      isPublic: false
    }))
  }
  if (favOnly) list = list.filter((v) => favIds.has(v.id))

  const pinned = list.filter((v) => favIds.has(v.id))
  const others = list.filter((v) => !favIds.has(v.id))
  const ordered = [...pinned, ...others]

  return (
    <div>
      <h1 className="view-title">{t.voicesTitle}</h1>

      <div className="voice-toolbar">
        <input
          className="input"
          style={{ maxWidth: 240 }}
          placeholder={t.searchVoices}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Dropdown
          trigger={
            <button className="pill">
              <Globe2 size={13} />
              {t.language}: <span className="pill__value">{lang ? langLabel(lang) : '—'}</span>
            </button>
          }
          searchable
          down
          options={[
            { value: '', label: '—' },
            ...SUPPORTED_LANGUAGES.map((code) => ({ value: code, label: langLabel(code) }))
          ]}
          value={lang}
          onSelect={setLang}
        />
        <Dropdown
          trigger={
            <button className="pill">
              {t.gender}:{' '}
              <span className="pill__value">
                {gender === 'masculine' ? t.masculine : gender === 'feminine' ? t.feminine : '—'}
              </span>
            </button>
          }
          down
          options={[
            { value: '', label: '—' },
            { value: 'masculine', label: t.masculine },
            { value: 'feminine', label: t.feminine }
          ]}
          value={gender}
          onSelect={setGender}
        />
        <button className="pill" onClick={() => setFavOnly((v) => !v)}
          style={favOnly ? { borderColor: 'var(--accent-border)', color: 'var(--accent-hover)' } : undefined}>
          <Star size={13} />
          {t.favorites}
        </button>
        <button className="pill" onClick={() => setClonesOnly((v) => !v)}
          style={clonesOnly ? { borderColor: 'var(--accent-border)', color: 'var(--accent-hover)' } : undefined}>
          <Mic size={13} />
          {t.myClones}
        </button>
        <span className="grow" />
        <Button
          variant="primary"
          icon={<Plus size={14} />}
          onClick={() => useUiStore.getState().setView('clone')}
          testId="open-clone-tab"
        >
          {t.cloneVoice}
        </Button>
      </div>

      {!keys.length ? (
        <EmptyState icon={<AudioLines size={40} />} title={t.noKeys} hint={t.addKeysHint} />
      ) : ordered.length ? (
        <>
          <div className="voice-grid">
            {ordered.map((voice) => {
              const clone = cloneById.get(voice.id)
              return (
                <div key={voice.id} className="voicecard">
                  <div className="voicecard__head">
                    <div className="voicecard__avatar" style={{ background: avatarColor(voice.id) }}>
                      {voice.name.slice(0, 1).toUpperCase()}
                    </div>
                    <span className="voicecard__name grow">{voice.name}</span>
                    <Dropdown
                      trigger={
                        <button className="iconbtn">
                          <MoreHorizontal size={15} />
                        </button>
                      }
                      down
                      right
                      options={[
                        { value: 'localize', label: t.localizeVoice, icon: <Globe2 size={14} /> },
                        ...(clone
                          ? [{ value: 'delete', label: t.delete, icon: <Trash2 size={14} /> }]
                          : [])
                      ]}
                      onSelect={(action) => {
                        if (action === 'localize') setLocalizeVoice(voice)
                        else setDeleteVoice(voice)
                      }}
                    />
                  </div>
                  <div className="voicecard__badges">
                    <Badge tone="neutral">{langLabel(voice.language)}</Badge>
                    {voice.gender ? (
                      <Badge tone="neutral">
                        {voice.gender === 'masculine' ? t.masculine : voice.gender === 'feminine' ? t.feminine : voice.gender}
                      </Badge>
                    ) : null}
                    {clone ? (
                      <Badge tone="accent">
                        {t.cloneBadge} · {clone.owningKeyLabel}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="voicecard__desc">{voice.description || ''}</div>
                  <div className="voicecard__footer">
                    <button
                      className="playbtn playbtn--sm playbtn--ghost"
                      title={t.listen}
                      data-testid="voice-sample-play"
                      onClick={() =>
                        void useSamplePlayer
                          .getState()
                          .toggle(
                            { id: voice.id, previewUrl: voice.previewUrl },
                            lang || voice.language
                          )
                      }
                    >
                      {loadingVoiceId === voice.id ? (
                        <span className="spinner" style={{ width: 11, height: 11 }} />
                      ) : playingVoiceId === voice.id ? (
                        <Pause size={13} />
                      ) : (
                        <Play size={13} style={{ marginLeft: 1 }} />
                      )}
                    </button>
                    <span className="grow" />
                    <IconButton
                      icon={<Star size={15} fill={favIds.has(voice.id) ? 'var(--warning)' : 'none'} />}
                      label={t.favorites}
                      active={favIds.has(voice.id)}
                      onClick={() =>
                        void window.cartelsia.voices
                          .favoritesToggle({
                            id: voice.id,
                            name: voice.name,
                            language: voice.language,
                            gender: voice.gender,
                            description: voice.description,
                            previewUrl: voice.previewUrl
                          })
                          .then((f) => useVoicesLocalStore.getState().setFavorites(f))
                      }
                    />
                  </div>
                </div>
              )
            })}
          </div>
          {hasMore && !clonesOnly ? (
            <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
              <Button loading={loading} onClick={() => load(true, cursor)}>
                {t.loadMore}
              </Button>
            </div>
          ) : null}
        </>
      ) : loading ? (
        <div className="row" style={{ justifyContent: 'center', padding: 40 }}>
          <span className="spinner" />
        </div>
      ) : (
        <EmptyState icon={<AudioLines size={40} />} title={t.voicesNotFound} />
      )}

      {localizeVoice ? (
        <LocalizeDialog voice={localizeVoice} onClose={() => setLocalizeVoice(null)} />
      ) : null}

      <ConfirmDialog
        open={!!deleteVoice}
        title={t.deleteCloneTitle}
        body={<span>{t.irreversible}</span>}
        confirmLabel={t.delete}
        danger
        onCancel={() => setDeleteVoice(null)}
        onConfirm={() => {
          const id = deleteVoice!.id
          setDeleteVoice(null)
          void window.cartelsia.voices.deleteClone(id).then(() => {
            void useVoicesLocalStore.getState().load()
            toast('info', t.cloneDeleted)
            load(false)
          })
        }}
      />
    </div>
  )
}

// ---------- Діалог локалізації ----------
function LocalizeDialog(props: { voice: CartesiaVoice; onClose: () => void }): React.JSX.Element {
  const [language, setLanguage] = useState('uk')
  const [gender, setGender] = useState<'male' | 'female'>('female')
  const [name, setName] = useState(`${props.voice.name} (UA)`)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.cartelsia.voices.localize({
        voiceId: props.voice.id,
        name,
        language,
        originalSpeakerGender: gender
      })
      await useVoicesLocalStore.getState().load()
      toast('success', t.voiceLocalized)
      props.onClose()
    } catch (err) {
      toast('danger', t.errorPrefix(err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title={`${t.localizeVoice}: ${props.voice.name}`}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            {t.cancel}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            {busy ? t.localizing : t.localize}
          </Button>
        </>
      }
    >
      <div>
        <span className="field-label">{t.voiceName}</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <span className="field-label">{t.targetLanguage}</span>
        <Dropdown
          trigger={<button className="pill">{langLabel(language)}</button>}
          searchable
          down
          options={SUPPORTED_LANGUAGES.map((code) => ({ value: code, label: langLabel(code) }))}
          value={language}
          onSelect={setLanguage}
        />
      </div>
      <div>
        <span className="field-label">{t.originalGender}</span>
        <Dropdown
          trigger={<button className="pill">{gender === 'male' ? t.masculine : t.feminine}</button>}
          down
          options={[
            { value: 'female', label: t.feminine },
            { value: 'male', label: t.masculine }
          ]}
          value={gender}
          onSelect={(g) => setGender(g as 'male' | 'female')}
        />
      </div>
    </Modal>
  )
}
