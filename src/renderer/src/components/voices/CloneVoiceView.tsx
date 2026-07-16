import { useRef, useState } from 'react'
import {
  AudioLines,
  Globe,
  KeyRound,
  Mic,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  Trash2,
  Upload
} from 'lucide-react'
import { SUPPORTED_LANGUAGES } from '@shared/types'
import { t, langLabel } from '../../i18n/uk'
import { toast, useKeysStore, useSettingsStore, useVoicesLocalStore } from '../../stores/appStore'
import { useSamplePlayer } from '../../audio/samplePlayer'
import { startRecording, type RecorderHandle } from '../../audio/recorder'
import {
  Badge,
  Button,
  ConfirmDialog,
  Dropdown,
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
