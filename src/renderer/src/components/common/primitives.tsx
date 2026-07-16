import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { t } from '../../i18n/uk'

// ---------- Button ----------
export function Button(props: {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  icon?: ReactNode
  loading?: boolean
  disabled?: boolean
  onClick?: () => void
  children?: ReactNode
  testId?: string
}): React.JSX.Element {
  const { variant = 'secondary', size = 'md' } = props
  return (
    <button
      className={`btn btn--${variant}${size === 'sm' ? ' btn--sm' : ''}`}
      disabled={props.disabled || props.loading}
      onClick={props.onClick}
      data-testid={props.testId}
    >
      {props.loading ? <span className="spinner" /> : props.icon}
      {props.children}
    </button>
  )
}

// ---------- IconButton ----------
export function IconButton(props: {
  icon: ReactNode
  label: string
  onClick?: (e: React.MouseEvent) => void
  active?: boolean
  danger?: boolean
  disabled?: boolean
  testId?: string
}): React.JSX.Element {
  return (
    <button
      className={`iconbtn${props.active ? ' is-active' : ''}${props.danger ? ' is-danger' : ''}`}
      title={props.label}
      aria-label={props.label}
      onClick={props.onClick}
      disabled={props.disabled}
      data-testid={props.testId}
    >
      {props.icon}
    </button>
  )
}

// ---------- Badge ----------
export function Badge(props: {
  tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'
  dot?: boolean
  spinner?: boolean
  children: ReactNode
  testId?: string
}): React.JSX.Element {
  return (
    <span className={`badge badge--${props.tone}`} data-testid={props.testId}>
      {props.spinner ? <span className="spinner" style={{ width: 10, height: 10 }} /> : null}
      {props.dot ? <span className="badge__dot" /> : null}
      {props.children}
    </span>
  )
}

// ---------- ProgressBar ----------
export function ProgressBar(props: {
  value: number
  max: number
  tone?: 'accent' | 'success' | 'warning' | 'danger'
}): React.JSX.Element {
  const pct = props.max > 0 ? Math.min(100, (props.value / props.max) * 100) : 0
  const toneClass =
    props.tone && props.tone !== 'accent' ? ` progress__fill--${props.tone}` : ''
  return (
    <div className="progress">
      <div className={`progress__fill${toneClass}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

// ---------- Modal ----------
export function Modal(props: {
  open: boolean
  title: string
  width?: number
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}): React.JSX.Element | null {
  useEffect(() => {
    if (!props.open) return
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [props.open, props.onClose])

  if (!props.open) return null
  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal" style={props.width ? { width: props.width } : undefined}>
        <div className="modal__header">
          <span>{props.title}</span>
          <IconButton icon={<X size={16} />} label={t.close} onClick={() => props.onClose()} />
        </div>
        <div className="modal__body">{props.children}</div>
        {props.footer ? <div className="modal__footer">{props.footer}</div> : null}
      </div>
    </div>
  )
}

// ---------- ConfirmDialog ----------
export function ConfirmDialog(props: {
  open: boolean
  title: string
  body: ReactNode
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element | null {
  return (
    <Modal
      open={props.open}
      title={props.title}
      onClose={props.onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={props.onCancel}>
            {t.cancel}
          </Button>
          <Button
            variant={props.danger ? 'danger' : 'primary'}
            onClick={props.onConfirm}
            testId="confirm-dialog-confirm"
          >
            {props.confirmLabel}
          </Button>
        </>
      }
    >
      {props.body}
    </Modal>
  )
}

// ---------- Toggle ----------
export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void }): React.JSX.Element {
  return (
    <button
      className={`toggle${props.checked ? ' is-on' : ''}`}
      role="switch"
      aria-checked={props.checked}
      onClick={() => props.onChange(!props.checked)}
    />
  )
}

// ---------- Slider ----------
export function Slider(props: {
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format?: (v: number) => string
}): React.JSX.Element {
  return (
    <div className="row" style={{ width: '100%' }}>
      <input
        type="range"
        className="slider"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <span className="text-sm muted tnum" style={{ minWidth: 44, textAlign: 'right' }}>
        {props.format ? props.format(props.value) : props.value}
      </span>
    </div>
  )
}

// ---------- Dropdown (popover-список) ----------
export interface DropdownOption<T extends string = string> {
  value: T
  label: string
  description?: string
  icon?: ReactNode
}

export function Dropdown<T extends string>(props: {
  trigger: ReactNode
  options: DropdownOption<T>[]
  value?: T
  onSelect: (v: T) => void
  searchable?: boolean
  down?: boolean
  right?: boolean
  testId?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const filtered = props.searchable
    ? props.options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : props.options

  return (
    <div className="popover-anchor" ref={ref} data-testid={props.testId}>
      <span onClick={() => setOpen((v) => !v)}>{props.trigger}</span>
      {open ? (
        <div
          className={`popover${props.down ? ' popover--down' : ''}${props.right ? ' popover--right' : ''}`}
        >
          {props.searchable ? (
            <div className="popover__search">
              <input
                className="input"
                autoFocus
                placeholder="Пошук…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          ) : null}
          <div className="popover__list">
            {filtered.map((o) => (
              <button
                key={o.value}
                className={`popover__item${o.value === props.value ? ' is-selected' : ''}`}
                onClick={() => {
                  props.onSelect(o.value)
                  setOpen(false)
                  setQuery('')
                }}
              >
                {o.icon}
                <span className="grow">
                  {o.label}
                  {o.description ? (
                    <span className="muted text-sm" style={{ display: 'block' }}>
                      {o.description}
                    </span>
                  ) : null}
                </span>
              </button>
            ))}
            {!filtered.length ? (
              <div className="muted text-sm" style={{ padding: '8px 10px' }}>
                Нічого не знайдено
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ---------- EmptyState ----------
export function EmptyState(props: {
  icon: ReactNode
  title: string
  hint?: string
  action?: ReactNode
}): React.JSX.Element {
  return (
    <div className="empty">
      {props.icon}
      <div className="empty__title">{props.title}</div>
      {props.hint ? <div className="empty__hint">{props.hint}</div> : null}
      {props.action}
    </div>
  )
}

// ---------- утиліти форматування ----------
export function fmtNum(n: number): string {
  return n.toLocaleString('uk-UA')
}

export function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}
