import { useMemo, useRef, useState } from 'react'
import { Cpu, Globe, SlidersHorizontal, Smile, Sparkles } from 'lucide-react'
import type { GenerationSettings, PreflightEstimate } from '@shared/types'
import { EMOTIONS_PRIMARY, SUPPORTED_LANGUAGES } from '@shared/types'
import { t, EMOTION_NAMES, langLabel } from '../../i18n/uk'
import {
  toast,
  totalRemaining,
  useChatsStore,
  useKeysStore,
  useSettingsStore,
  useUiStore
} from '../../stores/appStore'
import { Button, Dropdown, Modal, Slider, fmtNum } from '../common/primitives'
import { VoicePicker } from './VoicePicker'

const TAGS: { label: string; snippet: string; cursorInside?: boolean }[] = [
  { label: `${t.pauseTag} 0.5с`, snippet: '<break time="500ms"/>' },
  { label: `${t.pauseTag} 1с`, snippet: '<break time="1s"/>' },
  { label: t.spellTag, snippet: '<spell></spell>', cursorInside: true },
  { label: t.laughTag, snippet: '[laughter]' },
  { label: t.sighTag, snippet: '[sigh]' },
  { label: t.breathTag, snippet: '[breath]' }
]

export function Composer(): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const keys = useKeysStore((s) => s.keys)
  const [text, setText] = useState('')
  const [gen, setGen] = useState<Partial<GenerationSettings>>({})
  const [confirming, setConfirming] = useState<PreflightEstimate | null>(null)
  const [creating, setCreating] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const effective: GenerationSettings = useMemo(
    () => ({ ...(settings?.defaults ?? ({} as GenerationSettings)), ...gen }),
    [settings, gen]
  )

  const remaining = totalRemaining(keys)
  const charCount = text.length
  const chunkEstimate = Math.max(1, Math.ceil(charCount / (effective.chunkSize || 500)))
  const notEnough = charCount > 0 && charCount > remaining
  const canGenerate = charCount > 0 && !!effective.voiceId && !notEnough && !creating

  const insertAtCursor = (snippet: string, cursorInside?: boolean): void => {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart ?? text.length
    const end = el.selectionEnd ?? text.length
    const next = text.slice(0, start) + snippet + text.slice(end)
    setText(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = cursorInside ? start + snippet.length / 2 : start + snippet.length
      el.setSelectionRange(Math.floor(pos), Math.floor(pos))
    })
  }

  const submit = async (): Promise<void> => {
    if (!canGenerate) return
    const est = await window.cartelsia.tts.estimate(text, effective)
    setConfirming(est)
  }

  const start = async (): Promise<void> => {
    if (!confirming) return
    setCreating(true)
    try {
      const { chat } = await window.cartelsia.chats.create(text, effective)
      useChatsStore.getState().setChat(chat)
      useUiStore.getState().openChat(chat.id)
      await window.cartelsia.tts.start(chat.id)
      setText('')
      setConfirming(null)
    } catch (err) {
      toast('danger', t.errorPrefix(err instanceof Error ? err.message : String(err)))
    } finally {
      setCreating(false)
    }
  }

  const showOnboarding = !keys.length || !effective.voiceId

  return (
    <div className="composer">
      <div className="composer__greeting">{t.greeting}</div>

      <div className="composer__card">
        <textarea
          ref={textareaRef}
          className="composer__textarea"
          placeholder={t.textPlaceholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.ctrlKey && e.key === 'Enter') void submit()
          }}
          data-testid="composer-text"
        />
        <div className="composer__toolbar">
          <div className="composer__tags">
            {TAGS.map((tag) => (
              <button
                key={tag.label}
                className="tagchip"
                onClick={() => insertAtCursor(tag.snippet, tag.cursorInside)}
              >
                {tag.label}
              </button>
            ))}
          </div>
          <span className="composer__counter tnum" data-testid="char-counter">
            {fmtNum(charCount)} {t.chars} · ≈ {chunkEstimate} {t.chunksApprox}
          </span>
        </div>
      </div>

      <div className="composer__pills">
        <VoicePicker
          value={effective.voiceId}
          valueName={effective.voiceName}
          filterLanguage={effective.language}
          onChange={(v) =>
            setGen((g) => ({ ...g, voiceId: v.id, voiceName: v.name, voiceOwningKeyId: v.owningKeyId }))
          }
        />
        <Dropdown
          trigger={
            <button className="pill">
              <Cpu size={13} />
              {t.model}: <span className="pill__value">{effective.modelId}</span>
            </button>
          }
          options={[
            { value: 'sonic-3.5', label: 'sonic-3.5', description: 'Найновіша, рекомендовано' },
            { value: 'sonic-3', label: 'sonic-3', description: 'Попередня стабільна' }
          ]}
          value={effective.modelId}
          onSelect={(modelId) => setGen((g) => ({ ...g, modelId: modelId as 'sonic-3.5' | 'sonic-3' }))}
        />
        <Dropdown
          trigger={
            <button className="pill">
              <Globe size={13} />
              {t.language}:{' '}
              <span className="pill__value">
                {effective.language ? langLabel(effective.language) : t.auto}
              </span>
            </button>
          }
          searchable
          options={[
            { value: '', label: `🌐 ${t.auto}` },
            ...SUPPORTED_LANGUAGES.map((code) => ({
              value: code,
              label: langLabel(code)
            }))
          ]}
          value={effective.language ?? ''}
          onSelect={(lang) => setGen((g) => ({ ...g, language: lang || undefined }))}
        />
        <Dropdown
          trigger={
            <button className="pill">
              <Smile size={13} />
              {t.emotion}:{' '}
              <span className="pill__value">
                {EMOTION_NAMES[effective.emotion ?? 'neutral'] ?? effective.emotion}
              </span>
            </button>
          }
          options={EMOTIONS_PRIMARY.map((e) => ({ value: e, label: EMOTION_NAMES[e] ?? e }))}
          value={effective.emotion ?? 'neutral'}
          onSelect={(emotion) => setGen((g) => ({ ...g, emotion }))}
        />
        <ParamsPopover
          speed={effective.speed ?? 1}
          volume={effective.volume ?? 1}
          chunkSize={effective.chunkSize}
          onChange={(patch) => setGen((g) => ({ ...g, ...patch }))}
        />
      </div>

      <div className={`composer__estimate${notEnough ? ' is-danger' : ''}`} data-testid="estimate-line">
        {charCount > 0 ? (
          <>
            {t.needChars} ≈ <strong className="tnum">{fmtNum(charCount)}</strong> {t.chars} ·{' '}
            {t.availableChars} <strong className="tnum">{fmtNum(remaining)}</strong> {t.onKeys}{' '}
            {t.keysLoc(keys.filter((k) => k.status === 'active').length)}
            {notEnough ? <span> — {t.notEnoughChars}</span> : null}
          </>
        ) : showOnboarding ? (
          <div className="onboarding">
            <span className="onboarding__step">
              <span className="onboarding__num">1</span> {t.onboard1}
            </span>
            <span className="onboarding__step">
              <span className="onboarding__num">2</span> {t.onboard2}
            </span>
            <span className="onboarding__step">
              <span className="onboarding__num">3</span> {t.onboard3}
            </span>
          </div>
        ) : null}
      </div>

      <div className="composer__actions">
        <Button
          variant="primary"
          icon={<Sparkles size={15} />}
          disabled={!canGenerate}
          loading={creating}
          onClick={() => void submit()}
          testId="generate-btn"
        >
          {t.generate}
        </Button>
      </div>

      <Modal
        open={!!confirming}
        title={t.confirmTitle}
        onClose={() => setConfirming(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              {t.cancel}
            </Button>
            <Button
              variant="primary"
              loading={creating}
              onClick={() => void start()}
              testId="start-generation"
            >
              {confirming?.feasible ? t.startGeneration : t.generatePartial}
            </Button>
          </>
        }
      >
        {confirming ? (
          <>
            <p>{t.confirmSplit(confirming.chunkCount, confirming.totalChars)}</p>
            {!confirming.feasible ? (
              <p style={{ color: 'var(--warning)' }}>
                {t.blockedWarning(confirming.blockedChunks.length)}
              </p>
            ) : null}
            <div>
              <div className="field-label">{t.keyAllocation}</div>
              <table className="table">
                <thead>
                  <tr>
                    <th>{t.keyCol}</th>
                    <th>{t.chunksCol}</th>
                    <th>{t.charsCol}</th>
                    <th>{t.remainingAfterCol}</th>
                  </tr>
                </thead>
                <tbody>
                  {confirming.allocations.map((a) => (
                    <tr key={a.keyId}>
                      <td>{a.keyLabel}</td>
                      <td className="tnum">{a.chunkCount}</td>
                      <td className="tnum">{fmtNum(a.chars)}</td>
                      <td className="tnum">{fmtNum(a.remainingAfter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </Modal>
    </div>
  )
}

function ParamsPopover(props: {
  speed: number
  volume: number
  chunkSize: number
  onChange: (patch: Partial<GenerationSettings>) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  return (
    <div className="popover-anchor" ref={ref}>
      <button className="pill" onClick={() => setOpen((v) => !v)}>
        <SlidersHorizontal size={13} />
        {t.params}
      </button>
      {open ? (
        <div className="popover" style={{ minWidth: 280, padding: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <span className="field-label">{t.speed}</span>
              <Slider
                value={props.speed}
                min={0.6}
                max={1.5}
                step={0.05}
                onChange={(speed) => props.onChange({ speed })}
                format={(v) => `${v.toFixed(2)}×`}
              />
            </div>
            <div>
              <span className="field-label">{t.volume}</span>
              <Slider
                value={props.volume}
                min={0.5}
                max={2}
                step={0.05}
                onChange={(volume) => props.onChange({ volume })}
                format={(v) => `${v.toFixed(2)}×`}
              />
            </div>
            <div>
              <span className="field-label">{t.chunkSize}</span>
              <Slider
                value={props.chunkSize}
                min={100}
                max={2000}
                step={50}
                onChange={(chunkSize) => props.onChange({ chunkSize })}
                format={(v) => String(v)}
              />
            </div>
            <div style={{ textAlign: 'right' }}>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                {t.close}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
