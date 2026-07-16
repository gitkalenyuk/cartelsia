import { useEffect, useRef, useState } from 'react'
import {
  Download,
  Pause,
  Pencil,
  Play,
  RefreshCcw,
  RotateCcw
} from 'lucide-react'
import type { Chunk, ChunkStatus } from '@shared/types'
import { t } from '../../i18n/uk'
import { toast, useChatsStore } from '../../stores/appStore'
import { mediaUrl, usePlayerStore } from '../../stores/playerStore'
import { Badge, IconButton, fmtTime } from '../common/primitives'

const STATUS_TONE: Record<ChunkStatus, 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'> = {
  pending: 'neutral',
  'waiting-key': 'warning',
  running: 'accent',
  done: 'success',
  failed: 'danger',
  blocked: 'danger',
  cancelled: 'neutral'
}

function statusLabel(chunk: Chunk): string {
  switch (chunk.status) {
    case 'pending':
      return t.statusPending
    case 'waiting-key':
      return t.statusWaitingKey
    case 'running':
      return chunk.runningKeyLabel
        ? `${t.statusRunning} — ${chunk.runningKeyLabel}`
        : t.statusRunning
    case 'done':
      return t.statusDone
    case 'failed':
      return t.statusFailed
    case 'blocked':
      return t.statusBlocked
    case 'cancelled':
      return t.statusCancelled
  }
}

export function ChunkCard(props: { chatId: string; chunk: Chunk }): React.JSX.Element {
  const { chatId, chunk } = props
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(chunk.text)
  const editRef = useRef<HTMLTextAreaElement>(null)

  const current = usePlayerStore((s) => s.current)
  const playing = usePlayerStore((s) => s.playing)
  const currentTime = usePlayerStore((s) => s.currentTime)
  const duration = usePlayerStore((s) => s.duration)

  const selectedVersion =
    chunk.versions.find((v) => v.id === chunk.selectedVersionId) ??
    chunk.versions[chunk.versions.length - 1]
  const isCurrent = current?.chunkId === chunk.id
  const isPlaying = isCurrent && playing

  useEffect(() => {
    if (editing) {
      editRef.current?.focus()
      editRef.current?.setSelectionRange(draft.length, draft.length)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  const togglePlay = (): void => {
    if (!selectedVersion) return
    const player = usePlayerStore.getState()
    if (isCurrent) {
      player.toggle()
    } else {
      player.play({
        chatId,
        chunkId: chunk.id,
        versionId: selectedVersion.id,
        url: mediaUrl(chatId, selectedVersion.file)
      })
    }
  }

  const saveText = async (): Promise<void> => {
    setEditing(false)
    if (draft === chunk.text) return
    const updated = await window.cartelsia.chats.updateChunkText(chatId, chunk.id, draft)
    if (updated) useChatsStore.getState().applyChunk(chatId, updated)
  }

  const dur = isCurrent && duration ? duration : selectedVersion?.durationSec ?? 0
  const time = isCurrent ? currentTime : 0

  return (
    <div
      className={`chunk${isCurrent ? ' is-playing' : ''}`}
      data-testid="chunk-card"
      data-status={chunk.status}
      data-index={chunk.index}
    >
      <div className="chunk__header">
        <span className="chunk__index">#{chunk.index + 1}</span>
        <Badge
          tone={STATUS_TONE[chunk.status]}
          spinner={chunk.status === 'running'}
          testId="chunk-status"
        >
          {statusLabel(chunk)}
        </Badge>
        {chunk.status === 'done' && selectedVersion ? (
          <span className="muted text-sm" data-testid="chunk-key-label">
            {selectedVersion.keyLabel}
          </span>
        ) : null}
        <span className="chunk__spacer" />
        <div className="chunk__actions">
          {chunk.status === 'failed' || chunk.status === 'blocked' ? (
            <IconButton
              icon={<RotateCcw size={15} />}
              label={t.retry}
              onClick={() => void window.cartelsia.tts.retryChunk(chatId, chunk.id)}
              testId="chunk-retry"
            />
          ) : null}
          <IconButton
            icon={<Pencil size={15} />}
            label={t.edit}
            onClick={() => {
              setDraft(chunk.text)
              setEditing(true)
            }}
          />
          {chunk.versions.length ? (
            <IconButton
              icon={<RefreshCcw size={15} />}
              label={t.revoice}
              onClick={() => void window.cartelsia.tts.revoiceChunk(chatId, chunk.id)}
              testId="chunk-revoice"
            />
          ) : null}
          {selectedVersion ? (
            <IconButton
              icon={<Download size={15} />}
              label={t.downloadChunk}
              onClick={() =>
                void window.cartelsia.audio
                  .saveChunk(chatId, selectedVersion.file)
                  .then((res) => {
                    if (res.path)
                      toast('success', t.fileSaved, {
                        label: t.showInFolder,
                        onClick: () => void window.cartelsia.audio.reveal(res.path!)
                      })
                  })
              }
            />
          ) : null}
        </div>
      </div>

      {editing ? (
        <div>
          <textarea
            ref={editRef}
            className="textarea"
            rows={Math.min(8, Math.max(3, Math.ceil(draft.length / 80)))}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.ctrlKey && e.key === 'Enter') void saveText()
              if (e.key === 'Escape') setEditing(false)
            }}
          />
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="btn btn--ghost btn--sm" onClick={() => setEditing(false)}>
              {t.cancel}
            </button>
            <button className="btn btn--primary btn--sm" onClick={() => void saveText()}>
              {t.save}
            </button>
          </div>
        </div>
      ) : (
        <div className="chunk__text" data-selectable onDoubleClick={() => setEditing(true)}>
          {chunk.text}
        </div>
      )}

      {chunk.textEditedAfterVoice ? <div className="chunk__edit-note">{t.textEditedNote}</div> : null}
      {chunk.lastError && (chunk.status === 'failed' || chunk.status === 'blocked') ? (
        <div className="chunk__error" data-selectable>
          {chunk.lastError.message}
        </div>
      ) : null}

      {selectedVersion && chunk.status === 'done' ? (
        <>
          <div className="chunk__player">
            <button className="playbtn" onClick={togglePlay} data-testid="chunk-play">
              {isPlaying ? <Pause size={16} /> : <Play size={16} style={{ marginLeft: 2 }} />}
            </button>
            <div
              className="seek"
              onClick={(e) => {
                if (!isCurrent || !dur) return
                const rect = e.currentTarget.getBoundingClientRect()
                usePlayerStore.getState().seek(((e.clientX - rect.left) / rect.width) * dur)
              }}
            >
              <div className="seek__track">
                <div
                  className="seek__fill"
                  style={{ width: dur ? `${(time / dur) * 100}%` : '0%' }}
                />
              </div>
            </div>
            <span className="chunk__time tnum">
              {fmtTime(time)} / {fmtTime(dur)}
            </span>
          </div>
          {chunk.versions.length > 1 ? (
            <div className="versions">
              {chunk.versions.map((v, i) => (
                <button
                  key={v.id}
                  className={`version-chip${v.id === selectedVersion.id ? ' is-active' : ''}`}
                  title={`${v.settings.voiceName ?? ''} · ${v.settings.speed ?? 1}× · ${v.keyLabel}`}
                  onClick={() => {
                    void window.cartelsia.chats.selectVersion(chatId, chunk.id, v.id)
                    useChatsStore.getState().applyChunk(chatId, {
                      ...chunk,
                      selectedVersionId: v.id
                    })
                  }}
                >
                  v{i + 1}
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
