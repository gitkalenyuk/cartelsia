import { useEffect, useRef, useState } from 'react'
import {
  AudioLines,
  Check,
  Crown,
  Globe,
  KeyRound,
  Link2,
  Mic,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  Share2,
  Trash2,
  Upload
} from 'lucide-react'
import { SUPPORTED_LANGUAGES } from '@shared/types'
import type { SharedVoiceEntry } from '@shared/types'
import { t, langLabel } from '../../i18n/uk'
import { toast, useKeysStore, useSettingsStore, useSharedVoicesStore, useVoicesLocalStore } from '../../stores/appStore'
import { useSamplePlayer } from '../../audio/samplePlayer'
import { startRecording, type RecorderHandle } from '../../audio/recorder'
import {
  Badge,
  Button,
  ConfirmDialog,
  Dropdown,
  Hint,
  Modal,
  fmtNum
} from '../common/primitives'

export function CloneVoiceView(): React.JSX.Element {
  const keys = useKeysStore((s) => s.keys)
  const clones = useVoicesLocalStore((s) => s.clones)
  const [cloneKeyInput, setCloneKeyInput] = useState('')
  const [addingKey, setAddingKey] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [apiCloneOpen, setApiCloneOpen] = useState(false)
  const [deleteKeyId, setDeleteKeyId] = useState<string | null>(null)
  const playingVoiceId = useSamplePlayer((s) => s.playingVoiceId)
  const loadingVoiceId = useSamplePlayer((s) => s.loadingVoiceId)

  const cloneKeys = keys.filter((k) => k.role === 'clone')

  const addCloneKey = async (): Promise<void> => {
    const value = cloneKeyInput.trim()
    if (!value) return
    setAddingKey(true)
    try {
      const res = await window.cartelsia.keys.add([value], undefined, 'clone')
      await useKeysStore.getState().load()
      if (res.added.length) {
        toast('success', t.keysAdded(res.added.length))
        setCloneKeyInput('')
        await scan() // одразу шукаємо клони на новому ключі
      } else {
        toast('danger', t.keysRejected(res.rejected.length))
      }
    } finally {
      setAddingKey(false)
    }
  }

  const scan = async (): Promise<void> => {
    setScanning(true)
    try {
      const res = await window.cartelsia.voices.scanClones()
      await useVoicesLocalStore.getState().load()
      toast('success', t.scanResult(res.clones.length, res.scannedKeys))
      for (const err of res.errors) toast('danger', `${err.keyLabel}: ${err.message}`)
    } catch (err) {
      toast('danger', t.errorPrefix(err instanceof Error ? err.message : String(err)))
    } finally {
      setScanning(false)
    }
  }

  const useVoice = async (clone: { id: string; name: string; owningKeyId: string }): Promise<void> => {
    const settings = useSettingsStore.getState().settings
    if (!settings) return
    await useSettingsStore.getState().update({
      defaults: {
        ...settings.defaults,
        voiceId: clone.id,
        voiceName: clone.name,
        voiceOwningKeyId: clone.owningKeyId
      }
    })
    toast('success', `${t.defaultVoice}: ${clone.name}`)
  }

  return (
    <div>
      <h1 className="view-title">{t.cloneTabTitle}</h1>

      {/* Спільні голоси (2.1): будь-який voice_id з увімкненим Share */}
      <SharedVoicesSection />

      {/* Master-клонування (Pro-акаунт) */}
      <MasterCloneSection />

      {/* Інструкція */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="settings-section__title" style={{ marginBottom: 10 }}>
          {t.cloneHowTitle}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[t.cloneHowStep1, t.cloneHowStep2, t.cloneHowStep3].map((step, i) => (
            <div key={i} className="row" style={{ alignItems: 'flex-start' }}>
              <span className="onboarding__num" style={{ flexShrink: 0, marginTop: 2 }}>
                {i + 1}
              </span>
              <span className="muted" data-selectable>
                {step}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Клон-ключі */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="settings-section__title" style={{ marginBottom: 10 }}>
          <KeyRound size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
          {t.cloneKeysTitle}
        </div>
        <div className="row">
          <input
            className="input mono grow"
            placeholder={t.cloneKeyPlaceholder}
            value={cloneKeyInput}
            onChange={(e) => setCloneKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void addCloneKey()}
            data-testid="clone-key-input"
          />
          <Button
            variant="primary"
            icon={<Plus size={14} />}
            loading={addingKey}
            disabled={!cloneKeyInput.trim()}
            onClick={() => void addCloneKey()}
            testId="clone-key-add"
          >
            {t.addCloneKey}
          </Button>
        </div>
        {cloneKeys.length ? (
          <table className="table" style={{ marginTop: 12 }}>
            <tbody>
              {cloneKeys.map((k) => (
                <tr key={k.id}>
                  <td className="mono text-sm">{k.keyMasked}</td>
                  <td>{k.label}</td>
                  <td>
                    <Badge
                      tone={k.status === 'active' ? 'success' : k.status === 'frozen' ? 'warning' : 'danger'}
                      dot
                    >
                      {k.status === 'active' ? t.statusActive : k.status === 'frozen' ? t.statusFrozen : t.statusInvalid}
                    </Badge>
                  </td>
                  <td className="tnum text-sm muted">
                    {t.remaining}: {fmtNum(k.remaining)}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="iconbtn is-danger"
                      title={t.delete}
                      onClick={() => setDeleteKeyId(k.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      {/* Сканування + список клонів */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="settings-section__title" style={{ margin: 0 }}>
            {t.foundClones}
          </div>
          <span className="grow" />
          <Button
            icon={scanning ? undefined : <RefreshCcw size={14} />}
            loading={scanning}
            onClick={() => void scan()}
            testId="scan-clones"
          >
            {scanning ? t.scanning : t.scanClones}
          </Button>
        </div>
        {clones.length ? (
          <div className="voice-grid">
            {clones.map((clone) => (
              <div key={clone.id} className="voicecard">
                <div className="voicecard__head">
                  <div className="voicecard__avatar" style={{ background: 'var(--accent)' }}>
                    <Mic size={15} />
                  </div>
                  <span className="voicecard__name grow">{clone.name}</span>
                </div>
                <div className="voicecard__badges">
                  <Badge tone="neutral">{langLabel(clone.language)}</Badge>
                  <Badge tone="accent">
                    {t.cloneBadge} · {clone.owningKeyLabel}
                  </Badge>
                </div>
                <div className="voicecard__footer">
                  <button
                    className="playbtn playbtn--sm playbtn--ghost"
                    title={t.listen}
                    onClick={() =>
                      void useSamplePlayer.getState().toggle({ id: clone.id }, clone.language)
                    }
                  >
                    {loadingVoiceId === clone.id ? (
                      <span className="spinner" style={{ width: 11, height: 11 }} />
                    ) : playingVoiceId === clone.id ? (
                      <Pause size={13} />
                    ) : (
                      <Play size={13} style={{ marginLeft: 1 }} />
                    )}
                  </button>
                  <span className="grow" />
                  <Button size="sm" variant="secondary" onClick={() => void useVoice(clone)}>
                    {t.useVoice}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted text-sm">{t.noClones}</div>
        )}
      </div>

      {/* API-клонування (платний тариф) */}
      <div className="card">
        <div className="row">
          <div>
            <div className="settings-section__title" style={{ margin: 0 }}>
              {t.cloneViaApi}
            </div>
            <div className="muted text-sm" style={{ marginTop: 4 }}>
              {t.cloneApiNote}
            </div>
          </div>
          <span className="grow" />
          <Button variant="primary" icon={<Upload size={14} />} onClick={() => setApiCloneOpen(true)}>
            {t.cloneVoice}
          </Button>
        </div>
      </div>

      <CloneDialog open={apiCloneOpen} onClose={() => setApiCloneOpen(false)} />

      <ConfirmDialog
        open={!!deleteKeyId}
        title={t.deleteKeyTitle}
        body={<span>{t.irreversible}</span>}
        confirmLabel={t.delete}
        danger
        onCancel={() => setDeleteKeyId(null)}
        onConfirm={() => {
          const id = deleteKeyId!
          setDeleteKeyId(null)
          void window.cartelsia.keys.remove(id).then(() => {
            void useKeysStore.getState().load()
            toast('info', t.keyDeleted)
          })
        }}
      />
    </div>
  )
}

// ---------- Спільні голоси (2.1): голос за ID = доступний усім ключами ----------

function SharedVoicesSection(): React.JSX.Element {
  const shared = useSharedVoicesStore((s) => s.entries)
  const [voiceId, setVoiceId] = useState('')
  const [alias, setAlias] = useState('')
  const [adding, setAdding] = useState(false)
  const [checking, setChecking] = useState(false)
  const [deleteAlias, setDeleteAlias] = useState<string | null>(null)
  const playingVoiceId = useSamplePlayer((s) => s.playingVoiceId)
  const loadingVoiceId = useSamplePlayer((s) => s.loadingVoiceId)

  const add = async (): Promise<void> => {
    if (!voiceId.trim() || !alias.trim()) return
    setAdding(true)
    try {
      const res = await window.cartelsia.shared.add(voiceId.trim(), alias.trim())
      if (res.error) {
        toast('danger', res.error)
        return
      }
      if (res.entry) {
        toast('success', t.sharedAdded(res.entry.alias, res.entry.remoteName))
        setVoiceId('')
        setAlias('')
        await useSharedVoicesStore.getState().load()
      }
    } catch (err) {
      toast('danger', t.errorPrefix(err instanceof Error ? err.message : String(err)))
    } finally {
      setAdding(false)
    }
  }

  const checkAll = async (): Promise<void> => {
    setChecking(true)
    try {
      const results = await window.cartelsia.shared.check()
      await useSharedVoicesStore.getState().load()
      const revokedNow = results.filter((r) => r.status === 'revoked')
      if (revokedNow.length) {
        for (const r of revokedNow) toast('danger', t.sharedRevoked(r.alias))
      } else {
        toast('success', t.sharedCheckOk(results.length))
      }
    } catch (err) {
      toast('danger', t.errorPrefix(err instanceof Error ? err.message : String(err)))
    } finally {
      setChecking(false)
    }
  }

  const useSharedVoice = (entry: SharedVoiceEntry): void => {
    void useSettingsStore.getState().update({
      defaults: {
        ...useSettingsStore.getState().settings!.defaults,
        voiceId: entry.voiceId,
        voiceName: entry.remoteName,
        sharedVoiceAlias: entry.alias
      }
    })
    toast('success', `${t.defaultVoice}: ${entry.remoteName}`)
  }

  return (
    <div className="card" style={{ marginBottom: 16, borderColor: 'var(--accent-border)' }}>
      <div className="row" style={{ marginBottom: 10 }}>
        <div className="settings-section__title" style={{ margin: 0 }}>
          <Share2 size={14} style={{ verticalAlign: -2, marginRight: 6, color: 'var(--accent)' }} />
          {t.sharedTitle}
          <Hint text={t.sharedHint} />
        </div>
        <span className="grow" />
        <Button icon={checking ? undefined : <RefreshCcw size={14} />} loading={checking} disabled={!shared.length} onClick={() => void checkAll()}>
          {t.sharedCheck}
        </Button>
      </div>

      <div className="muted text-sm" style={{ marginBottom: 12 }} data-selectable>
        {t.sharedIntro}
      </div>

      <div className="row">
        <input
          className="input mono grow"
          style={{ minWidth: 220 }}
          placeholder="afe1bd4e-954e-48cc-8225-22c0… (Voice ID)"
          value={voiceId}
          onChange={(e) => setVoiceId(e.target.value)}
          data-testid="shared-voice-id"
        />
        <input
          className="input"
          style={{ width: 170 }}
          placeholder={t.sharedAliasPlaceholder}
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
          data-testid="shared-alias"
        />
        <Button variant="primary" icon={<Plus size={14} />} loading={adding} disabled={!voiceId.trim() || !alias.trim()} onClick={() => void add()} testId="shared-add">
          {t.sharedAdd}
        </Button>
      </div>

      {shared.length ? (
        <table className="table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>{t.sharedColAlias}</th>
              <th>{t.sharedColName}</th>
              <th>{t.language}</th>
              <th>{t.sharedColStatus}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shared.map((s) => (
              <tr key={s.alias}>
                <td className="mono text-sm">{s.alias}</td>
                <td className="text-sm">{s.remoteName}{s.isPro ? ' 👑' : ''}</td>
                <td className="text-sm">{langLabel(s.language)}</td>
                <td>
                  <Badge tone={s.status === 'ok' ? 'success' : s.status === 'revoked' ? 'danger' : 'warning'} dot>
                    {s.status === 'ok' ? t.sharedStatusOk : s.status === 'revoked' ? t.sharedStatusRevoked : t.sharedStatusUnreachable}
                  </Badge>
                  {!s.isOwner ? (
                    <span style={{ marginLeft: 6, display: 'inline-block' }}>
                      <Badge tone="neutral">{t.sharedExternal}</Badge>
                    </span>
                  ) : null}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button
                    className={`playbtn playbtn--sm playbtn--ghost`}
                    title={t.listen}
                    onClick={() => void useSamplePlayer.getState().toggle({ id: s.voiceId }, s.language)}
                  >
                    {loadingVoiceId === s.voiceId ? (
                      <span className="spinner" style={{ width: 11, height: 11 }} />
                    ) : playingVoiceId === s.voiceId ? (
                      <Pause size={13} />
                    ) : (
                      <Play size={13} style={{ marginLeft: 1 }} />
                    )}
                  </button>
                  <span style={{ marginLeft: 6, display: 'inline-block' }}>
                    <Button size="sm" variant="secondary" onClick={() => useSharedVoice(s)}>
                      {t.useVoice}
                    </Button>
                  </span>
                  <button className="iconbtn is-danger" title={t.delete} style={{ marginLeft: 6 }} onClick={() => setDeleteAlias(s.alias)}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="muted text-sm" style={{ marginTop: 10 }}>
          {t.sharedEmpty}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteAlias}
        title={t.sharedRemoveTitle}
        body={<span>{t.sharedRemoveBody(deleteAlias ?? '')}</span>}
        confirmLabel={t.delete}
        danger
        onCancel={() => setDeleteAlias(null)}
        onConfirm={() => {
          const al = deleteAlias!
          setDeleteAlias(null)
          void window.cartelsia.shared.remove(al).then(() => {
            void useSharedVoicesStore.getState().load()
            toast('info', t.sharedRemoved(al))
          })
        }}
      />
    </div>
  )
}

// ---------- Master-секція (2.0.1): клонування через Pro-акаунт ----------

function useMasterStatus(): import('@shared/types').MasterStatus | null {
  const [status, setStatus] = useState<import('@shared/types').MasterStatus | null>(null)
  useEffect(() => {
    let cancelled = false
    void window.cartelsia.master.status().then((st) => {
      if (!cancelled) setStatus(st)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return status
}

function MasterCloneSection(): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const masterConfigured = !!settings?.masterApiKey
  const status = useMasterStatus()
  const [dialogOpen, setDialogOpen] = useState(false)
  const clones = useVoicesLocalStore((s) => s.clones)
  const playingVoiceId = useSamplePlayer((s) => s.playingVoiceId)
  const loadingVoiceId = useSamplePlayer((s) => s.loadingVoiceId)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const masterClones = clones.filter((c) => c.viaMaster)

  const togglePublic = async (voiceId: string): Promise<void> => {
    setTogglingId(voiceId)
    try {
      await window.cartelsia.master.togglePublic(voiceId)
      await useVoicesLocalStore.getState().load()
      toast('success', t.masterNowPublic)
    } catch (err) {
      toast('danger', t.errorPrefix(err instanceof Error ? err.message : String(err)))
    } finally {
      setTogglingId(null)
    }
  }

  if (!masterConfigured) return <></>

  return (
    <div className="card" style={{ marginBottom: 16, borderColor: 'var(--accent-border)' }}>
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="settings-section__title" style={{ margin: 0 }}>
          <Crown size={14} style={{ verticalAlign: -2, marginRight: 6, color: 'var(--accent)' }} />
          {t.masterCloneTitle}
        </div>
        <span className="grow" />
        {status && (
          <Badge tone={status.valid ? 'success' : 'danger'} dot>
            {status.valid ? 'Master OK' : 'Master ✗'}
          </Badge>
        )}
        <Button
          variant="primary"
          icon={<Plus size={14} />}
          onClick={() => setDialogOpen(true)}
          testId="master-clone-open"
        >
          {t.masterCloneSubmit}
        </Button>
      </div>

      {masterClones.length ? (
        <div className="voice-grid">
          {masterClones.map((clone) => (
            <div key={clone.id} className="voicecard">
              <div className="voicecard__head">
                <div
                  className="voicecard__avatar"
                  style={{ background: 'linear-gradient(135deg, var(--accent), #b8845f)' }}
                >
                  <Mic size={15} />
                </div>
                <span className="voicecard__name grow">{clone.name}</span>
                <button
                  className="iconbtn"
                  title={`${t.masterToggle} — зараз ${clone.isPublic ? 'публічний' : 'приватний'}`}
                  disabled={togglingId === clone.id}
                  onClick={() => void togglePublic(clone.id)}
                >
                  {togglingId === clone.id ? (
                    <span className="spinner" style={{ width: 12, height: 12 }} />
                  ) : (
                    <Globe size={13} style={{ opacity: clone.isPublic ? 1 : 0.35 }} />
                  )}
                </button>
              </div>
              <div className="voicecard__badges">
                <Badge tone="neutral">{langLabel(clone.language)}</Badge>
                <Badge tone="accent">{t.masterBadge}</Badge>
                <Badge tone={clone.isPublic ? 'success' : 'warning'}>
                  {clone.isPublic ? t.masterPublicBadge : t.masterPrivateBadge}
                </Badge>
              </div>
              <div className="voicecard__footer">
                <button
                  className="playbtn playbtn--sm playbtn--ghost"
                  title={t.listen}
                  onClick={() =>
                    void useSamplePlayer.getState().toggle({ id: clone.id }, clone.language)
                  }
                >
                  {loadingVoiceId === clone.id ? (
                    <span className="spinner" style={{ width: 11, height: 11 }} />
                  ) : playingVoiceId === clone.id ? (
                    <Pause size={13} />
                  ) : (
                    <Play size={13} style={{ marginLeft: 1 }} />
                  )}
                </button>
                <span className="grow" />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void useSettingsStore.getState().update({
                      defaults: {
                        ...useSettingsStore.getState().settings!.defaults,
                        voiceId: clone.id,
                        voiceName: clone.name
                      }
                    })
                    toast('success', `${t.defaultVoice}: ${clone.name}`)
                  }}
                >
                  {t.useVoice}
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="muted text-sm">{t.noClones}</div>
      )}

      <MasterCloneDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  )
}

function MasterCloneDialog(props: { open: boolean; onClose: () => void }): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const [tab, setTab] = useState<'file' | 'mic'>('file')
  const [name, setName] = useState('')
  const [language, setLanguage] = useState('uk')
  const [description, setDescription] = useState('')
  const [makePublic, setMakePublic] = useState(settings?.masterAutoPublic !== false)
  const [clip, setClip] = useState<{ data: ArrayBuffer; mimeType: string; label: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const [recording, setRecording] = useState(false)
  const [level, setLevel] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null)
  const handleRef = useRef<RecorderHandle | null>(null)

  useEffect(() => {
    if (props.open && settings) setMakePublic(settings.masterAutoPublic !== false)
  }, [props.open, settings])

  const reset = (): void => {
    setName('')
    setDescription('')
    setClip(null)
    setRecordedUrl(null)
    setRecording(false)
    handleRef.current?.cancel()
  }

  const record = async (): Promise<void> => {
    if (recording) {
      handleRef.current?.stop()
      return
    }
    setRecordedUrl(null)
    setClip(null)
    setElapsed(0)
    try {
      handleRef.current = await startRecording({
        maxSeconds: 10,
        onLevel: setLevel,
        onTick: setElapsed,
        onDone: (blob) => {
          setRecording(false)
          void blob.arrayBuffer().then((data) => {
            setClip({ data, mimeType: blob.type || 'audio/webm', label: 'Запис із мікрофона' })
            setRecordedUrl(URL.createObjectURL(blob))
          })
        }
      })
      setRecording(true)
    } catch (err) {
      toast('danger', t.errorPrefix(err instanceof Error ? err.message : String(err)))
    }
  }

  const submit = async (): Promise<void> => {
    if (!clip || !name.trim()) return
    setBusy(true)
    try {
      const res = await window.cartelsia.master.clone({
        clip: clip.data,
        mimeType: clip.mimeType,
        name: name.trim(),
        language,
        description: description.trim() || undefined,
        makePublic
      })
      await useVoicesLocalStore.getState().load()
      toast('success', res.reused ? t.masterClonedReused : t.masterCloned(res.voice.name))
      if (res.madePublic) toast('info', t.masterNowPublic)
      reset()
      props.onClose()
    } catch (err) {
      toast('danger', t.errorPrefix(err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={props.open}
      title={t.masterCloneTitle}
      onClose={() => {
        reset()
        props.onClose()
      }}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              reset()
              props.onClose()
            }}
          >
            {t.cancel}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!clip || !name.trim()}
            onClick={() => void submit()}
            testId="master-clone-submit"
          >
            {busy ? t.masterCloning : t.masterCloneSubmit}
          </Button>
        </>
      }
    >
      <div className="row">
        <button className="pill" onClick={() => setTab('file')}
          style={tab === 'file' ? { borderColor: 'var(--accent-border)', color: 'var(--accent-hover)' } : undefined}>
          <Upload size={13} /> {t.uploadFile}
        </button>
        <button className="pill" onClick={() => setTab('mic')}
          style={tab === 'mic' ? { borderColor: 'var(--accent-border)', color: 'var(--accent-hover)' } : undefined}>
          <Mic size={13} /> {t.recordMic}
        </button>
      </div>

      {tab === 'file' ? (
        <div
          className="card"
          style={{ textAlign: 'center', cursor: 'pointer', borderStyle: 'dashed' }}
          onClick={() => fileRef.current?.click()}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".mp3,.wav,.ogg,.webm,.flac,.m4a,audio/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file)
                void file.arrayBuffer().then((data) =>
                  setClip({ data, mimeType: file.type || 'audio/mpeg', label: file.name })
                )
            }}
          />
          <Upload size={22} style={{ color: 'var(--text-faint)' }} />
          <div className="muted" style={{ marginTop: 6 }}>
            {clip && tab === 'file' ? clip.label : t.chooseAudioFile}
          </div>
        </div>
      ) : (
        <div className="recorder">
          <button className={`recorder__btn${recording ? ' is-recording' : ''}`} onClick={() => void record()}>
            <Mic size={26} />
          </button>
          {recording ? (
            <>
              <div className="recorder__meter">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div
                    key={i}
                    className="recorder__bar"
                    style={{ height: `${Math.max(10, level * 100 * (0.5 + Math.sin(i * 1.7) * 0.5))}%` }}
                  />
                ))}
              </div>
              <div className="recorder__time">{t.recording(Math.min(elapsed, 10))} / 10 с</div>
            </>
          ) : recordedUrl ? (
            <div className="row">
              <audio controls src={recordedUrl} style={{ height: 32 }} />
              <Button size="sm" variant="ghost" onClick={() => void record()}>
                {t.recordAgain}
              </Button>
            </div>
          ) : (
            <div className="muted text-sm">до 10 секунд</div>
          )}
        </div>
      )}

      <div>
        <span className="field-label">{t.masterCloneName}</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <span className="field-label">
            {t.masterCloneLanguage}{' '}
            <Hint text="Мова, якою говорить людина в кліпі. Повинна збігатися з реальною мовою аудіо" />
          </span>
          <Dropdown
            trigger={<button className="pill"><Globe size={13} /> {langLabel(language)}</button>}
            searchable
            down
            options={SUPPORTED_LANGUAGES.map((code) => ({ value: code, label: langLabel(code) }))}
            value={language}
            onSelect={setLanguage}
          />
        </div>
        <div className="grow">
          <span className="field-label">
            {t.masterCloneMakePublic}{' '}
            <Hint text={t.masterAutoPublicHint} />
          </span>
          <label className="row" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={makePublic}
              onChange={(e) => setMakePublic(e.target.checked)}
              data-testid="master-clone-public"
            />
            <span className="text-sm">{makePublic ? t.masterPublicBadge : t.masterPrivateBadge}</span>
          </label>
        </div>
      </div>
      <div>
        <span className="field-label">{t.masterCloneDescription}</span>
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
    </Modal>
  )
}

// ---------- Діалог API-клонування (файл або мікрофон) ----------
function CloneDialog(props: { open: boolean; onClose: () => void }): React.JSX.Element {
  const keys = useKeysStore((s) => s.keys)
  const [tab, setTab] = useState<'file' | 'mic'>('file')
  const [name, setName] = useState('')
  const [language, setLanguage] = useState('uk')
  const [description, setDescription] = useState('')
  const [keyId, setKeyId] = useState('')
  const [clip, setClip] = useState<{ data: ArrayBuffer; mimeType: string; label: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const [recording, setRecording] = useState(false)
  const [level, setLevel] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null)
  const handleRef = useRef<RecorderHandle | null>(null)

  const reset = (): void => {
    setName('')
    setDescription('')
    setClip(null)
    setRecordedUrl(null)
    setRecording(false)
    handleRef.current?.cancel()
  }

  const record = async (): Promise<void> => {
    if (recording) {
      handleRef.current?.stop()
      return
    }
    setRecordedUrl(null)
    setClip(null)
    setElapsed(0)
    try {
      handleRef.current = await startRecording({
        maxSeconds: 10,
        onLevel: setLevel,
        onTick: setElapsed,
        onDone: (blob) => {
          setRecording(false)
          void blob.arrayBuffer().then((data) => {
            setClip({ data, mimeType: blob.type, label: 'Запис із мікрофона' })
            setRecordedUrl(URL.createObjectURL(blob))
          })
        }
      })
      setRecording(true)
    } catch (err) {
      toast('danger', t.errorPrefix(err instanceof Error ? err.message : String(err)))
    }
  }

  const submit = async (): Promise<void> => {
    if (!clip || !name.trim()) return
    setBusy(true)
    try {
      await window.cartelsia.voices.clone({
        keyId: keyId || undefined,
        name: name.trim(),
        language,
        description: description.trim() || undefined,
        clip: clip.data,
        mimeType: clip.mimeType
      })
      await useVoicesLocalStore.getState().load()
      toast('success', t.voiceCloned)
      reset()
      props.onClose()
    } catch (err) {
      toast('danger', t.errorPrefix(err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={props.open}
      title={t.cloneVoice}
      onClose={() => {
        reset()
        props.onClose()
      }}
      footer={
        <>
          <Button variant="ghost" onClick={() => { reset(); props.onClose() }}>
            {t.cancel}
          </Button>
          <Button variant="primary" loading={busy} disabled={!clip || !name.trim()} onClick={() => void submit()}>
            {busy ? t.cloning : t.createClone}
          </Button>
        </>
      }
    >
      <div className="muted text-sm">{t.cloneApiNote}</div>
      <div className="row">
        <button className="pill" onClick={() => setTab('file')}
          style={tab === 'file' ? { borderColor: 'var(--accent-border)', color: 'var(--accent-hover)' } : undefined}>
          <Upload size={13} /> {t.uploadFile}
        </button>
        <button className="pill" onClick={() => setTab('mic')}
          style={tab === 'mic' ? { borderColor: 'var(--accent-border)', color: 'var(--accent-hover)' } : undefined}>
          <Mic size={13} /> {t.recordMic}
        </button>
      </div>

      {tab === 'file' ? (
        <div
          className="card"
          style={{ textAlign: 'center', cursor: 'pointer', borderStyle: 'dashed' }}
          onClick={() => fileRef.current?.click()}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".mp3,.wav,.ogg,.webm,.flac,.m4a,audio/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file)
                void file.arrayBuffer().then((data) =>
                  setClip({ data, mimeType: file.type || 'audio/mpeg', label: file.name })
                )
            }}
          />
          <Upload size={22} style={{ color: 'var(--text-faint)' }} />
          <div className="muted" style={{ marginTop: 6 }}>
            {clip && tab === 'file' ? clip.label : t.chooseAudioFile}
          </div>
        </div>
      ) : (
        <div className="recorder">
          <button className={`recorder__btn${recording ? ' is-recording' : ''}`} onClick={() => void record()}>
            <Mic size={26} />
          </button>
          {recording ? (
            <>
              <div className="recorder__meter">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div
                    key={i}
                    className="recorder__bar"
                    style={{ height: `${Math.max(10, level * 100 * (0.5 + Math.sin(i * 1.7) * 0.5))}%` }}
                  />
                ))}
              </div>
              <div className="recorder__time">{t.recording(Math.min(elapsed, 10))} / 10 с</div>
            </>
          ) : recordedUrl ? (
            <div className="row">
              <audio controls src={recordedUrl} style={{ height: 32 }} />
              <Button size="sm" variant="ghost" onClick={() => void record()}>
                {t.recordAgain}
              </Button>
            </div>
          ) : (
            <div className="muted text-sm">до 10 секунд</div>
          )}
        </div>
      )}

      <div>
        <span className="field-label">{t.voiceName}</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <span className="field-label">{t.language}</span>
          <Dropdown
            trigger={<button className="pill"><Globe size={13} /> {langLabel(language)}</button>}
            searchable
            down
            options={SUPPORTED_LANGUAGES.map((code) => ({ value: code, label: langLabel(code) }))}
            value={language}
            onSelect={setLanguage}
          />
        </div>
        <div className="grow">
          <span className="field-label">{t.owningKey}</span>
          <Dropdown
            trigger={
              <button className="pill">
                <AudioLines size={13} />{' '}
                {keyId ? keys.find((k) => k.id === keyId)?.label ?? t.auto : t.auto}
              </button>
            }
            down
            options={[
              { value: '', label: t.auto },
              ...keys.filter((k) => k.status !== 'invalid').map((k) => ({ value: k.id, label: k.label }))
            ]}
            value={keyId}
            onSelect={setKeyId}
          />
        </div>
      </div>
      <div>
        <span className="field-label">{t.description}</span>
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
    </Modal>
  )
}
