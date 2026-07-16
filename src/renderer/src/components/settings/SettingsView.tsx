import { Folder } from 'lucide-react'
import { t } from '../../i18n/uk'
import { useSettingsStore } from '../../stores/appStore'
import { Button, Dropdown, Slider, Toggle } from '../common/primitives'
import { VoicePicker } from '../chat/VoicePicker'

function Row(props: {
  label: string
  desc?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="setting-row">
      <div className="setting-row__info">
        <div className="setting-row__label">{props.label}</div>
        {props.desc ? <div className="setting-row__desc">{props.desc}</div> : null}
      </div>
      <div className="setting-row__control">{props.children}</div>
    </div>
  )
}

export function SettingsView(): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const paths = useSettingsStore((s) => s.paths)
  const update = useSettingsStore((s) => s.update)

  if (!settings)
    return (
      <div className="row" style={{ justifyContent: 'center', paddingTop: '20vh' }}>
        <span className="spinner" />
      </div>
    )

  const d = settings.defaults
  const formatLabel =
    d.output.container === 'wav'
      ? 'WAV'
      : `MP3 ${(d.output.bitRate ?? 128000) / 1000} kbps`

  return (
    <div>
      <h1 className="view-title">{t.settingsTitle}</h1>

      <div className="settings-section">
        <div className="settings-section__title">{t.sectionGeneration}</div>
        <Row label={t.defaultModel}>
          <Dropdown
            trigger={<button className="pill">{d.modelId}</button>}
            down
            right
            options={[
              { value: 'sonic-3.5', label: 'sonic-3.5' },
              { value: 'sonic-3', label: 'sonic-3' }
            ]}
            value={d.modelId}
            onSelect={(modelId) =>
              void update({ defaults: { ...d, modelId: modelId as 'sonic-3.5' | 'sonic-3' } })
            }
          />
        </Row>
        <Row label={t.defaultVoice}>
          <VoicePicker
            value={d.voiceId}
            valueName={d.voiceName}
            onChange={(v) =>
              void update({
                defaults: { ...d, voiceId: v.id, voiceName: v.name, voiceOwningKeyId: v.owningKeyId }
              })
            }
          />
        </Row>
        <Row label={t.audioFormat}>
          <Dropdown
            trigger={<button className="pill">{formatLabel}</button>}
            down
            right
            options={[
              { value: 'mp3-128', label: 'MP3 128 kbps / 44.1 kHz' },
              { value: 'mp3-192', label: 'MP3 192 kbps / 44.1 kHz' },
              { value: 'wav', label: 'WAV (PCM 16-bit / 44.1 kHz)' }
            ]}
            value={d.output.container === 'wav' ? 'wav' : `mp3-${(d.output.bitRate ?? 128000) / 1000}`}
            onSelect={(v) =>
              void update({
                defaults: {
                  ...d,
                  output:
                    v === 'wav'
                      ? { container: 'wav', sampleRate: 44100 }
                      : { container: 'mp3', sampleRate: 44100, bitRate: v === 'mp3-192' ? 192000 : 128000 }
                }
              })
            }
          />
        </Row>
        <Row label={t.chunkSize}>
          <div style={{ width: 220 }}>
            <Slider
              value={d.chunkSize}
              min={100}
              max={2000}
              step={50}
              onChange={(chunkSize) => void update({ defaults: { ...d, chunkSize } })}
            />
          </div>
        </Row>
        <Row label={t.concurrency} desc={t.concurrencyDesc}>
          <Dropdown
            trigger={
              <button className="pill">
                {settings.globalConcurrencyCap ? String(settings.globalConcurrencyCap) : t.auto}
              </button>
            }
            down
            right
            options={[
              { value: '0', label: t.auto },
              ...[1, 2, 3, 4, 6, 8].map((n) => ({ value: String(n), label: String(n) }))
            ]}
            value={String(settings.globalConcurrencyCap ?? 0)}
            onSelect={(v) =>
              void update({ globalConcurrencyCap: Number(v) || undefined })
            }
          />
        </Row>
        <Row label={t.subtitleMode} desc={t.subtitleModeDesc}>
          <Toggle
            checked={d.subtitleMode}
            onChange={(subtitleMode) => void update({ defaults: { ...d, subtitleMode } })}
          />
        </Row>
      </div>

      <div className="settings-section">
        <div className="settings-section__title">{t.sectionMerge}</div>
        <Row label={t.silenceBetween} desc={t.silenceDesc}>
          <input
            className="input tnum"
            style={{ width: 76 }}
            type="number"
            min={0}
            max={5000}
            step={50}
            value={d.silenceMs}
            onChange={(e) => void update({ defaults: { ...d, silenceMs: Number(e.target.value) } })}
          />
          <span className="muted text-sm">{t.ms}</span>
        </Row>
        <Row label={t.autoMerge}>
          <Toggle
            checked={d.autoMerge}
            onChange={(autoMerge) => void update({ defaults: { ...d, autoMerge } })}
          />
        </Row>
      </div>

      <div className="settings-section">
        <div className="settings-section__title">{t.sectionFiles}</div>
        <Row label={t.outputFolder}>
          <span className="mono text-sm muted" data-selectable>
            {paths?.outputDir ?? ''}
          </span>
          <Button
            size="sm"
            icon={<Folder size={13} />}
            onClick={() => paths && void window.cartelsia.audio.reveal(paths.outputDir)}
          >
            {t.open}
          </Button>
        </Row>
        <Row label={t.dataFolder}>
          <span className="mono text-sm muted" data-selectable>
            {paths?.dataDir ?? ''}
          </span>
          <Button
            size="sm"
            icon={<Folder size={13} />}
            onClick={() => paths && void window.cartelsia.audio.reveal(paths.dataDir)}
          >
            {t.open}
          </Button>
        </Row>
      </div>

      <div className="settings-section">
        <div className="settings-section__title">{t.sectionNotify}</div>
        <Row label={t.systemNotify}>
          <Toggle
            checked={settings.notifySystem}
            onChange={(notifySystem) => void update({ notifySystem })}
          />
        </Row>
        <Row label={t.soundNotify}>
          <Toggle
            checked={settings.notifySound}
            onChange={(notifySound) => void update({ notifySound })}
          />
        </Row>
      </div>
    </div>
  )
}
