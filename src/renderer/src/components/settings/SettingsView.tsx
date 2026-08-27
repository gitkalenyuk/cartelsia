import { useState } from 'react'
import { Folder, MailCheck } from 'lucide-react'
import { t } from '../../i18n/uk'
import { toast, useSettingsStore } from '../../stores/appStore'
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
  const [testingImap, setTestingImap] = useState(false)

  if (!settings)
    return (
      <div className="row" style={{ justifyContent: 'center', paddingTop: '20vh' }}>
        <span className="spinner" />
      </div>
    )

  const handleTestImap = async (): Promise<void> => {
    setTestingImap(true)
    try {
      const res = await window.cartelsia.email.testImap(settings.imapConfig)
      if (res.ok) {
        toast('success', t.imapOk)
      } else {
        toast('danger', t.imapFailed(res.error || 'Помилка'))
      }
    } catch (err) {
      toast('danger', t.imapFailed(err instanceof Error ? err.message : String(err)))
    } finally {
      setTestingImap(false)
    }
  }

  // Проксі-керування переїхало у вкладку Автореєстрація → Проксі (2.0)

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
        <div className="settings-section__title">{t.sectionCatchAll}</div>
        <Row label={t.catchAllDomain} desc={t.catchAllDomainDesc}>
          <input
            className="input"
            style={{ width: 220 }}
            placeholder="my-domain.com"
            value={settings.catchAllDomain ?? ''}
            onChange={(e) => void update({ catchAllDomain: e.target.value.trim() })}
          />
        </Row>
        <Row label={t.imapHost}>
          <input
            className="input"
            style={{ width: 220 }}
            placeholder="imap.gmail.com"
            value={settings.imapConfig?.host ?? ''}
            onChange={(e) =>
              void update({
                imapConfig: {
                  host: e.target.value.trim(),
                  port: settings.imapConfig?.port ?? 993,
                  user: settings.imapConfig?.user ?? '',
                  pass: settings.imapConfig?.pass ?? '',
                  tls: true
                }
              })
            }
          />
        </Row>
        <Row label={t.imapPort}>
          <input
            className="input tnum"
            style={{ width: 100 }}
            type="number"
            placeholder="993"
            value={settings.imapConfig?.port ?? 993}
            onChange={(e) =>
              void update({
                imapConfig: {
                  host: settings.imapConfig?.host ?? 'imap.gmail.com',
                  port: Number(e.target.value) || 993,
                  user: settings.imapConfig?.user ?? '',
                  pass: settings.imapConfig?.pass ?? '',
                  tls: true
                }
              })
            }
          />
        </Row>
        <Row label={t.imapUser}>
          <input
            className="input"
            style={{ width: 220 }}
            placeholder="user@gmail.com"
            value={settings.imapConfig?.user ?? ''}
            onChange={(e) =>
              void update({
                imapConfig: {
                  host: settings.imapConfig?.host ?? 'imap.gmail.com',
                  port: settings.imapConfig?.port ?? 993,
                  user: e.target.value.trim(),
                  pass: settings.imapConfig?.pass ?? '',
                  tls: true
                }
              })
            }
          />
        </Row>
        <Row
          label={t.imapPass}
          desc="Для Gmail потрібен Пароль додатку (App Password), створений на myaccount.google.com/apppasswords"
        >
          <input
            className="input"
            type="password"
            style={{ width: 220 }}
            placeholder="16-значний App Password"
            value={settings.imapConfig?.pass ?? ''}
            onChange={(e) =>
              void update({
                imapConfig: {
                  host: settings.imapConfig?.host ?? 'imap.gmail.com',
                  port: settings.imapConfig?.port ?? 993,
                  user: settings.imapConfig?.user ?? '',
                  pass: e.target.value,
                  tls: true
                }
              })
            }
          />
        </Row>
        <Row label="">
          <Button
            size="sm"
            icon={<MailCheck size={13} />}
            disabled={testingImap}
            onClick={() => void handleTestImap()}
          >
            {testingImap ? 'Перевіряю…' : t.testImap}
          </Button>
        </Row>
      </div>

      <div className="settings-section">
        <div className="settings-section__title">{t.sectionAutoregOptions}</div>
        <Row label={t.autoregEngine} desc={t.autoregEngineDesc}>
          <button className="pill" disabled style={{ opacity: 0.7 }}>Browser Signup 2.0</button>
        </Row>
        <Row label={t.autoregThreads} desc={t.autoregThreadsDesc}>
          <input
            className="input tnum"
            style={{ width: 80 }}
            type="number"
            min={1}
            max={50}
            step={1}
            placeholder="5"
            value={settings.autoreg?.concurrency ?? ''}
            onChange={(e) =>
              void update({
                autoreg: {
                  ...settings.autoreg,
                  concurrency: Math.max(1, Math.min(50, Number(e.target.value))) || undefined
                }
              })
            }
          />
          <span className="muted text-sm">{t.autoregThreadsUnit}</span>
        </Row>
        <Row label={t.autoregDelayMs} desc={t.autoregDelayMsDesc}>
          <input
            className="input tnum"
            style={{ width: 100 }}
            type="number"
            min={0}
            max={30000}
            step={500}
            placeholder="4000"
            value={settings.autoreg?.delayMs ?? ''}
            onChange={(e) =>
              void update({ autoreg: { ...settings.autoreg, delayMs: Number(e.target.value) || undefined } })
            }
          />
          <span className="muted text-sm">мс</span>
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
