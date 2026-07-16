import { useEffect, useMemo, useState } from 'react'
import {
  Captions,
  Download,
  ListMusic,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Square,
  X
} from 'lucide-react'
import type { Chat } from '@shared/types'
import { t } from '../../i18n/uk'
import { toast, useChatsStore, useQueueStore, useSettingsStore } from '../../stores/appStore'
import { mediaUrl, usePlayerStore, type PlayerTrack } from '../../stores/playerStore'
import { mergeChat, suggestedMergeName } from '../../audio/mergeService'
import { Button, Dropdown, IconButton, Modal, ProgressBar, Toggle, fmtDateTime, fmtNum } from '../common/primitives'
import { ChunkCard } from './ChunkCard'

export function GenerationView(props: { chat: Chat }): React.JSX.Element {
  const { chat } = props
  const queue = useQueueStore((s) => s.byChatId[chat.id])
  const pausedInfo = useQueueStore((s) => s.pausedInfo[chat.id])
  const playlist = usePlayerStore((s) => s.playlist)
  const playlistIndex = usePlayerStore((s) => s.playlistIndex)
  const playing = usePlayerStore((s) => s.playing)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [title, setTitle] = useState(chat.title)

  useEffect(() => setTitle(chat.title), [chat.title])

  const doneChunks = useMemo(
    () => chat.chunks.filter((c) => c.status === 'done'),
    [chat.chunks]
  )
  const total = chat.chunks.length
  const done = doneChunks.length
  const failed = chat.chunks.filter((c) => c.status === 'failed' || c.status === 'blocked').length
  const running = queue?.state === 'running' || chat.status === 'running'
  const charsTotal = chat.chunks.reduce((s, c) => s + c.text.length, 0)
  const charsDone = doneChunks.reduce((s, c) => s + c.text.length, 0)

  // автоскрол до поточного чанка плейліста
  const currentTrack = usePlayerStore((s) => s.current)
  useEffect(() => {
    if (!playlist || !currentTrack) return
    const el = document.querySelector(`[data-testid="chunk-card"][data-index="${
      chat.chunks.find((c) => c.id === currentTrack.chunkId)?.index ?? -1
    }"]`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [currentTrack, playlist, chat.chunks])

  const playAll = (): void => {
    const tracks: PlayerTrack[] = doneChunks
      .sort((a, b) => a.index - b.index)
      .map((c) => {
        const v = c.versions.find((x) => x.id === c.selectedVersionId) ?? c.versions[c.versions.length - 1]
        return { chatId: chat.id, chunkId: c.id, versionId: v.id, url: mediaUrl(chat.id, v.file) }
      })
    usePlayerStore.getState().playAll(tracks)
  }

  const exportSubs = async (format: 'srt' | 'vtt'): Promise<void> => {
    const res = await window.cartelsia.subtitles.export(chat.id, format)
    if (res.error) toast('danger', res.error)
    else if (res.path)
      toast('success', t.subtitlesExported, {
        label: t.showInFolder,
        onClick: () => void window.cartelsia.audio.reveal(res.path!)
      })
  }

  return (
    <div>
      <div className="genbar">
        <div className="genbar__row">
          <input
            className="genbar__title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              if (title !== chat.title) void window.cartelsia.chats.rename(chat.id, title)
            }}
          />
          {running ? (
            <IconButton
              icon={<Pause size={16} />}
              label={t.pause}
              onClick={() => void window.cartelsia.tts.pause(chat.id)}
            />
          ) : chat.status === 'paused' ? (
            <IconButton
              icon={<Play size={16} />}
              label={t.resume}
              onClick={() => void window.cartelsia.tts.resume(chat.id)}
              testId="resume-queue"
            />
          ) : null}
          {running || chat.status === 'paused' ? (
            <IconButton
              icon={<Square size={15} />}
              label={t.cancelQueue}
              danger
              onClick={() => void window.cartelsia.tts.cancel(chat.id)}
            />
          ) : null}
          <Button
            size="sm"
            icon={<ListMusic size={14} />}
            disabled={!doneChunks.length}
            onClick={playAll}
            testId="play-all"
          >
            {t.playAll}
          </Button>
          <Dropdown
            trigger={
              <Button size="sm" icon={<Captions size={14} />}>
                {t.subtitles}
              </Button>
            }
            options={[
              { value: 'srt', label: t.exportSrt },
              { value: 'vtt', label: t.exportVtt }
            ]}
            down
            right
            onSelect={(f) => void exportSubs(f as 'srt' | 'vtt')}
          />
          <Button
            size="sm"
            variant="primary"
            icon={<Download size={14} />}
            disabled={!doneChunks.length}
            onClick={() => setMergeOpen(true)}
            testId="download-all"
          >
            {t.downloadAll}
          </Button>
        </div>
        <div className="genbar__progress-row">
          <span className="tnum">{t.progressOf(done, total)}</span>
          <div className="genbar__progress">
            <ProgressBar
              value={done}
              max={total}
              tone={failed ? 'warning' : done === total ? 'success' : 'accent'}
            />
          </div>
          <span className="tnum">{t.charsUsed(fmtNum(charsDone), fmtNum(charsTotal))}</span>
        </div>
        {pausedInfo ? (
          <div className="genbar__progress-row" style={{ color: 'var(--warning)' }}>
            {t.waitingUnfreeze}
            {pausedInfo.resumeAt ? ` · ${t.resumeAt(fmtDateTime(pausedInfo.resumeAt))}` : ''}
          </div>
        ) : null}
      </div>

      <div className="chunks" data-testid="chunk-list">
        {chat.chunks.map((chunk) => (
          <ChunkCard key={chunk.id} chatId={chat.id} chunk={chunk} />
        ))}
      </div>

      {playlist ? (
        <div className="playall">
          <IconButton
            icon={<SkipBack size={15} />}
            label="Попередній"
            onClick={() => usePlayerStore.getState().prev()}
          />
          <button className="playbtn playbtn--sm" onClick={() => usePlayerStore.getState().toggle()}>
            {playing ? <Pause size={14} /> : <Play size={14} style={{ marginLeft: 1 }} />}
          </button>
          <IconButton
            icon={<SkipForward size={15} />}
            label="Наступний"
            onClick={() => usePlayerStore.getState().next()}
          />
          <span className="playall__label tnum">
            {playlistIndex + 1} / {playlist.length}
          </span>
          <span className="grow" />
          <IconButton
            icon={<X size={15} />}
            label={t.stopPlayback}
            onClick={() => usePlayerStore.getState().stop()}
          />
        </div>
      ) : null}

      <MergeDialog chat={chat} open={mergeOpen} onClose={() => setMergeOpen(false)} />
    </div>
  )
}

function MergeDialog(props: { chat: Chat; open: boolean; onClose: () => void }): React.JSX.Element {
  const { chat } = props
  const settings = useSettingsStore((s) => s.settings)
  const format = chat.settings.output.container
  const [filename, setFilename] = useState('')
  const [silenceOn, setSilenceOn] = useState(true)
  const [silenceMs, setSilenceMs] = useState(chat.settings.silenceMs ?? 300)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (props.open) setFilename(suggestedMergeName(chat, format))
  }, [props.open, chat, format])

  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      const data = await mergeChat(chat, {
        silenceMs: silenceOn ? silenceMs : 0,
        format,
        bitrateKbps: (chat.settings.output.bitRate ?? 128000) / 1000,
        sampleRate: chat.settings.output.sampleRate
      })
      const res = await window.cartelsia.audio.saveMerged(chat.id, data, format, filename)
      if (res.path) {
        toast('success', t.fileSaved, {
          label: t.showInFolder,
          onClick: () => void window.cartelsia.audio.reveal(res.path!)
        })
        props.onClose()
      }
    } catch (err) {
      toast('danger', t.errorPrefix(err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={props.open}
      title={t.mergeTitle}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            {t.cancel}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void run()} testId="merge-confirm">
            {busy ? t.merging : t.mergeAndSave}
          </Button>
        </>
      }
    >
      <div>
        <span className="field-label">{t.filename}</span>
        <input className="input" value={filename} onChange={(e) => setFilename(e.target.value)} />
      </div>
      <div className="setting-row" style={{ borderBottom: 'none', padding: 0 }}>
        <div className="setting-row__info">
          <div className="setting-row__label">{t.silenceBetween}</div>
          <div className="setting-row__desc">{settings ? t.silenceDesc : ''}</div>
        </div>
        <div className="setting-row__control">
          <Toggle checked={silenceOn} onChange={setSilenceOn} />
          {silenceOn ? (
            <>
              <input
                className="input tnum"
                style={{ width: 76 }}
                type="number"
                min={0}
                max={5000}
                step={50}
                value={silenceMs}
                onChange={(e) => setSilenceMs(Number(e.target.value))}
              />
              <span className="muted text-sm">{t.ms}</span>
            </>
          ) : null}
        </div>
      </div>
    </Modal>
  )
}
