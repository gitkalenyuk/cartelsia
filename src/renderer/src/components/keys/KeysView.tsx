import { useRef, useState } from 'react'
import {
  FileText,
  KeyRound,
  MoreHorizontal,
  Pencil,
  RefreshCcw,
  Trash2
} from 'lucide-react'
import type { ApiKeyPublic } from '@shared/types'
import { t } from '../../i18n/uk'
import { toast, totalRemaining, useKeysStore } from '../../stores/appStore'
import {
  Badge,
  Button,
  ConfirmDialog,
  Dropdown,
  Modal,
  ProgressBar,
  fmtDateTime,
  fmtNum
} from '../common/primitives'

function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000))
}

export function KeysView(): React.JSX.Element {
  const allKeys = useKeysStore((s) => s.keys)
  // клон-ключі керуються на вкладці «Клон голосу»
  const keys = allKeys.filter((k) => k.role !== 'clone')
  const [pasteValue, setPasteValue] = useState('')
  const [adding, setAdding] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const dragCounter = useRef(0)

  const active = keys.filter((k) => k.status === 'active')
  const frozen = keys.filter((k) => k.status === 'frozen')

  const addFromText = async (text: string): Promise<void> => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim())
    if (!lines.length) return
    setAdding(true)
    try {
      const res = await window.cartelsia.keys.add(lines)
      await useKeysStore.getState().load()
      const msg =
        t.keysAdded(res.added.length) +
        (res.rejected.length ? ` (${t.keysRejected(res.rejected.length)})` : '')
      toast(res.added.length ? 'success' : 'danger', msg)
      setPasteValue('')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault()
        dragCounter.current++
        setDragOver(true)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        dragCounter.current--
        if (dragCounter.current <= 0) setDragOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        dragCounter.current = 0
        setDragOver(false)
        const file = e.dataTransfer.files[0]
        if (file && file.name.endsWith('.txt')) {
          void file.text().then((text) => addFromText(text))
        }
      }}
      style={{ minHeight: 'calc(100vh - 80px)' }}
    >
      <h1 className="view-title">{t.keysTitle}</h1>

      <div className="stats-row">
        <div className="statcard">
          <div className="statcard__label">{t.totalAvailable}</div>
          <div className="statcard__value" data-testid="total-remaining">
            {fmtNum(totalRemaining(keys))}
          </div>
          <div className="statcard__sub">{t.chars}</div>
        </div>
        <div className="statcard">
          <div className="statcard__label">{t.activeKeys}</div>
          <div className="statcard__value">{active.length}</div>
        </div>
        <div className="statcard">
          <div className="statcard__label">{t.frozenKeys}</div>
          <div className="statcard__value">{frozen.length}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="field-label">{t.addKeys}</div>
        <textarea
          className="textarea mono"
          rows={3}
          placeholder={t.pasteKeysPlaceholder}
          value={pasteValue}
          onChange={(e) => setPasteValue(e.target.value)}
          data-testid="keys-input"
        />
        <div className="row" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
          <Button
            icon={<FileText size={14} />}
            onClick={() =>
              void window.cartelsia.keys.importTxt().then(async (res) => {
                await useKeysStore.getState().load()
                if (res.added.length || res.rejected.length)
                  toast(
                    res.added.length ? 'success' : 'danger',
                    t.keysAdded(res.added.length) +
                      (res.rejected.length ? ` (${t.keysRejected(res.rejected.length)})` : '')
                  )
              })
            }
          >
            {t.importTxt}
          </Button>
          <Button
            variant="primary"
            loading={adding}
            disabled={!pasteValue.trim()}
            onClick={() => void addFromText(pasteValue)}
            testId="keys-add-btn"
          >
            {t.add}
          </Button>
        </div>
      </div>

      {keys.length ? (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="table" data-testid="keys-table">
            <thead>
              <tr>
                <th>{t.keyCol}</th>
                <th>{t.label}</th>
                <th>{t.status}</th>
                <th>{t.used}</th>
                <th>{t.remaining}</th>
                <th>{t.unfreezesAt}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <KeyRow key={k.id} apiKey={k} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">
          <KeyRound size={40} />
          <div className="empty__title">{t.noKeys}</div>
          <div className="empty__hint">{t.noKeysHint}</div>
        </div>
      )}

      {dragOver ? <div className="dropzone-overlay">{t.dropToImport}</div> : null}
    </div>
  )
}

function KeyRow(props: { apiKey: ApiKeyPublic }): React.JSX.Element {
  const k = props.apiKey
  const [checking, setChecking] = useState(false)
  const [probeAsk, setProbeAsk] = useState(false)
  const [limitOpen, setLimitOpen] = useState(false)
  const [limitValue, setLimitValue] = useState(String(k.limit))
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [labelEditing, setLabelEditing] = useState(false)
  const [labelValue, setLabelValue] = useState(k.label)

  const runProbe = async (quotaProbe: boolean): Promise<void> => {
    setProbeAsk(false)
    setChecking(true)
    try {
      const res = await window.cartelsia.keys.probe(k.id, quotaProbe)
      if (!res.authValid) toast('danger', t.keyInvalid)
      else if (quotaProbe && res.quotaOk) toast('success', k.status === 'frozen' ? t.keyUnfrozen : t.keyValid)
      else if (quotaProbe && res.quotaOk === false) toast('info', t.keyStillFrozen)
      else toast('success', t.keyValid)
      await useKeysStore.getState().load()
    } finally {
      setChecking(false)
    }
  }

  const statusBadge =
    k.status === 'active' ? (
      <Badge tone="success" dot testId="key-status">
        {t.statusActive}
      </Badge>
    ) : k.status === 'frozen' ? (
      <Badge tone="warning" dot testId="key-status">
        {t.statusFrozen}
      </Badge>
    ) : (
      <Badge tone="danger" dot testId="key-status">
        {t.statusInvalid}
      </Badge>
    )

  return (
    <tr className={k.status === 'invalid' ? 'is-dimmed' : ''} data-testid="key-row">
      <td>
        <span
          className="keymask"
          title="Натисніть, щоб скопіювати"
          onClick={() => {
            void navigator.clipboard.writeText(k.keyMasked)
            toast('info', t.copied)
          }}
        >
          {k.keyMasked}
        </span>
      </td>
      <td>
        {labelEditing ? (
          <input
            className="input"
            style={{ width: 120 }}
            autoFocus
            value={labelValue}
            onChange={(e) => setLabelValue(e.target.value)}
            onBlur={() => {
              setLabelEditing(false)
              if (labelValue !== k.label)
                void window.cartelsia.keys.update(k.id, { label: labelValue })
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <span style={{ cursor: 'pointer' }} onClick={() => setLabelEditing(true)}>
            {k.label}
          </span>
        )}
      </td>
      <td>{statusBadge}</td>
      <td className="keyusage">
        <ProgressBar
          value={k.usedChars}
          max={k.limit}
          tone={k.status === 'frozen' ? 'warning' : k.usedChars / k.limit > 0.85 ? 'danger' : 'accent'}
        />
        <div className="keyusage__text">
          {fmtNum(k.usedChars)} / {fmtNum(k.limit)}
        </div>
      </td>
      <td className="tnum" data-testid="key-remaining">
        {fmtNum(k.remaining)}
      </td>
      <td className="text-sm muted">
        {k.status === 'frozen' && k.frozenUntil ? (
          <span data-testid="unfreeze-date">
            {fmtDateTime(k.frozenUntil)}
            <br />
            {t.inDays(daysUntil(k.frozenUntil))}
          </span>
        ) : (
          '—'
        )}
      </td>
      <td>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button
            className="btn btn--ghost btn--sm"
            disabled={checking}
            onClick={() => setProbeAsk(true)}
            data-testid="key-check"
          >
            {checking ? <span className="spinner" /> : <RefreshCcw size={13} />}
            {checking ? t.checking : 'Перевірити'}
          </button>
          <Dropdown
            trigger={
              <button className="iconbtn">
                <MoreHorizontal size={15} />
              </button>
            }
            options={[
              { value: 'limit', label: t.changeLimit, icon: <Pencil size={14} /> },
              { value: 'delete', label: t.delete, icon: <Trash2 size={14} /> }
            ]}
            down
            right
            onSelect={(action) => {
              if (action === 'limit') {
                setLimitValue(String(k.limit))
                setLimitOpen(true)
              } else setDeleteOpen(true)
            }}
          />
        </div>

        <Modal
          open={probeAsk}
          title={t.quotaProbeTitle}
          onClose={() => setProbeAsk(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setProbeAsk(false)}>
                {t.cancel}
              </Button>
              <Button onClick={() => void runProbe(false)} testId="probe-free">
                {t.quotaProbeFree}
              </Button>
              <Button variant="primary" onClick={() => void runProbe(true)}>
                {t.quotaProbeReal}
              </Button>
            </>
          }
        >
          <span>{t.quotaProbeBody}</span>
        </Modal>

        <Modal
          open={limitOpen}
          title={t.changeLimit}
          onClose={() => setLimitOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setLimitOpen(false)}>
                {t.cancel}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setLimitOpen(false)
                  void window.cartelsia.keys.update(k.id, { limit: Number(limitValue) || 20000 })
                }}
              >
                {t.save}
              </Button>
            </>
          }
        >
          <div>
            <span className="field-label">{t.limitLabel}</span>
            <input
              className="input tnum"
              type="number"
              min={0}
              value={limitValue}
              onChange={(e) => setLimitValue(e.target.value)}
            />
          </div>
        </Modal>

        <ConfirmDialog
          open={deleteOpen}
          title={t.deleteKeyTitle}
          body={<span>{t.irreversible}</span>}
          confirmLabel={t.delete}
          danger
          onCancel={() => setDeleteOpen(false)}
          onConfirm={() => {
            setDeleteOpen(false)
            void window.cartelsia.keys.remove(k.id).then(() => {
              void useKeysStore.getState().load()
              toast('info', t.keyDeleted)
            })
          }}
        />
      </td>
    </tr>
  )
}
