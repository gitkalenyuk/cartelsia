import { useState } from 'react'
import {
  Plus,
  KeyRound,
  AudioLines,
  BarChart3,
  Settings as SettingsIcon,
  MoreHorizontal,
  Trash2,
  Pencil
} from 'lucide-react'
import { t } from '../../i18n/uk'
import {
  totalRemaining,
  useChatsStore,
  useKeysStore,
  useUiStore,
  type ViewId
} from '../../stores/appStore'
import { Button, ConfirmDialog, Dropdown, fmtNum } from '../common/primitives'

const NAV: { view: ViewId; label: string; icon: React.JSX.Element }[] = [
  { view: 'keys', label: t.keys, icon: <KeyRound size={16} /> },
  { view: 'voices', label: t.voices, icon: <AudioLines size={16} /> },
  { view: 'stats', label: t.stats, icon: <BarChart3 size={16} /> },
  { view: 'settings', label: t.settings, icon: <SettingsIcon size={16} /> }
]

function groupLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diff = (today.getTime() - day.getTime()) / 86_400_000
  if (diff < 1) return t.today
  if (diff < 2) return t.yesterday
  if (diff < 7) return t.thisWeek
  return t.earlier
}

export function Sidebar(): React.JSX.Element {
  const view = useUiStore((s) => s.view)
  const activeChatId = useUiStore((s) => s.activeChatId)
  const openChat = useUiStore((s) => s.openChat)
  const setView = useUiStore((s) => s.setView)
  const summaries = useChatsStore((s) => s.summaries)
  const keys = useKeysStore((s) => s.keys)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const remaining = totalRemaining(keys)
  const activeKeys = keys.filter((k) => k.status === 'active').length
  const low = remaining < 2000

  const groups: { label: string; items: typeof summaries }[] = []
  for (const chat of summaries) {
    const label = groupLabel(chat.createdAt)
    let group = groups.find((g) => g.label === label)
    if (!group) {
      group = { label, items: [] }
      groups.push(group)
    }
    group.items.push(chat)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__brand-dot" />
        Cartelsia
      </div>
      <div className="sidebar__new">
        <Button
          variant="secondary"
          icon={<Plus size={15} style={{ color: 'var(--accent)' }} />}
          onClick={() => openChat(null)}
          testId="new-generation"
        >
          {t.newGeneration}
        </Button>
      </div>
      <nav className="sidebar__nav">
        {NAV.map((item) => (
          <button
            key={item.view}
            className={`navitem${view === item.view ? ' is-active' : ''}`}
            onClick={() => setView(item.view)}
            data-testid={`nav-${item.view}`}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>
      {summaries.length ? <div className="sidebar__section">{t.history}</div> : null}
      <div className="sidebar__chats">
        {groups.map((group) => (
          <div key={group.label}>
            <div className="sidebar__section" style={{ padding: '8px 10px 4px' }}>
              {group.label}
            </div>
            {group.items.map((chat) => (
              <div
                key={chat.id}
                className={`chatitem${chat.id === activeChatId && view === 'chat' ? ' is-active' : ''}`}
                onClick={() => openChat(chat.id)}
                data-testid="chat-item"
              >
                <span className="chatitem__title">{chat.title}</span>
                <span className="chatitem__kebab" onClick={(e) => e.stopPropagation()}>
                  <Dropdown
                    trigger={
                      <button className="iconbtn" style={{ width: 22, height: 22 }}>
                        <MoreHorizontal size={14} />
                      </button>
                    }
                    options={[
                      { value: 'rename', label: t.rename, icon: <Pencil size={14} /> },
                      { value: 'delete', label: t.delete, icon: <Trash2 size={14} /> }
                    ]}
                    down
                    right
                    onSelect={(action) => {
                      if (action === 'delete') setDeleteId(chat.id)
                      else {
                        setRenameId(chat.id)
                        setRenameValue(chat.title)
                      }
                    }}
                  />
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div
        className={`sidebar__footer${low ? ' is-low' : ''}`}
        onClick={() => setView('keys')}
        data-testid="pool-footer"
      >
        {t.availableChars}{' '}
        <strong className="tnum">{fmtNum(remaining)}</strong> {t.chars} ·{' '}
        <strong className="tnum">{activeKeys}</strong> {t.keysGenitive}
      </div>

      <ConfirmDialog
        open={!!deleteId}
        title={`${t.delete}?`}
        body={<span>{t.irreversible}</span>}
        confirmLabel={t.delete}
        danger
        onCancel={() => setDeleteId(null)}
        onConfirm={() => {
          const id = deleteId!
          setDeleteId(null)
          void window.cartelsia.chats.delete(id).then(() => {
            useChatsStore.getState().removeChat(id)
            if (useUiStore.getState().activeChatId === id) openChat(null)
          })
        }}
      />

      {renameId ? (
        <ConfirmDialog
          open
          title={t.rename}
          body={
            <input
              className="input"
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
            />
          }
          confirmLabel={t.save}
          onCancel={() => setRenameId(null)}
          onConfirm={() => {
            const id = renameId
            setRenameId(null)
            void window.cartelsia.chats.rename(id, renameValue).then(() => {
              void useChatsStore.getState().loadList()
            })
          }}
        />
      ) : null}
    </aside>
  )
}
