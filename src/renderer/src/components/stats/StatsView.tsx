import { useEffect, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import type { StatsSummary } from '@shared/types'
import { t } from '../../i18n/uk'
import { useChatsStore, useUiStore } from '../../stores/appStore'
import { Badge, EmptyState, fmtDateTime, fmtNum } from '../common/primitives'

const CHART_COLORS = ['#d97757', '#8aa9c9', '#7fa66f', '#d4a027', '#b58bc9', '#6fb8ad']

export function StatsView(): React.JSX.Element {
  const [stats, setStats] = useState<StatsSummary | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [tooltip, setTooltip] = useState<{ x: number; y: number; day: string; lines: string[] } | null>(null)
  const summaries = useChatsStore((s) => s.summaries)

  useEffect(() => {
    void window.cartelsia.stats.get().then(setStats)
  }, [])

  if (!stats)
    return (
      <div className="row" style={{ justifyContent: 'center', paddingTop: '20vh' }}>
        <span className="spinner" />
      </div>
    )

  const keyIds = Object.keys(stats.keyLabels)
  const colorOf = (keyId: string): string =>
    CHART_COLORS[Math.max(0, keyIds.indexOf(keyId)) % CHART_COLORS.length]

  const visibleDays = stats.days
  const maxTotal = Math.max(
    1,
    ...visibleDays.map((d) =>
      Object.entries(d.perKey)
        .filter(([k]) => !hidden.has(k))
        .reduce((s, [, v]) => s + v, 0)
    )
  )

  const W = 720
  const H = 180
  const PAD = 24
  const barW = (W - PAD * 2) / visibleDays.length

  return (
    <div>
      <h1 className="view-title">{t.statsTitle}</h1>

      <div className="stats-row">
        <div className="statcard">
          <div className="statcard__label">{t.totalGenerated}</div>
          <div className="statcard__value">{fmtNum(stats.totalChars)}</div>
          <div className="statcard__sub">{t.chars}</div>
        </div>
        <div className="statcard">
          <div className="statcard__label">{t.thisMonth}</div>
          <div className="statcard__value">{fmtNum(stats.monthChars)}</div>
          <div className="statcard__sub">{t.chars}</div>
        </div>
        <div className="statcard">
          <div className="statcard__label">{t.activeKeys}</div>
          <div className="statcard__value">{stats.activeKeys}</div>
        </div>
        <div className="statcard">
          <div className="statcard__label">{t.avgPerDay}</div>
          <div className="statcard__value">{fmtNum(stats.avgPerDay)}</div>
          <div className="statcard__sub">{t.chars}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="field-label">{t.consumption30}</div>
        {stats.totalChars > 0 ? (
          <>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              style={{ width: '100%', height: 'auto' }}
              onMouseLeave={() => setTooltip(null)}
            >
              {[0.25, 0.5, 0.75].map((f) => (
                <line
                  key={f}
                  x1={PAD}
                  x2={W - PAD}
                  y1={H - 20 - (H - 40) * f}
                  y2={H - 20 - (H - 40) * f}
                  stroke="var(--border-subtle)"
                  strokeWidth={1}
                />
              ))}
              {visibleDays.map((day, i) => {
                let y = H - 20
                const segments = Object.entries(day.perKey).filter(([k]) => !hidden.has(k))
                const total = segments.reduce((s, [, v]) => s + v, 0)
                return (
                  <g
                    key={day.day}
                    onMouseMove={(e) => {
                      if (!total) return
                      setTooltip({
                        x: e.clientX + 12,
                        y: e.clientY - 10,
                        day: day.day,
                        lines: segments.map(
                          ([k, v]) => `${stats.keyLabels[k] ?? k}: ${fmtNum(v)}`
                        )
                      })
                    }}
                  >
                    <rect
                      x={PAD + i * barW}
                      y={20}
                      width={Math.max(1, barW - 2)}
                      height={H - 40}
                      fill="transparent"
                    />
                    {segments.map(([keyId, chars]) => {
                      const h = ((H - 40) * chars) / maxTotal
                      y -= h
                      return (
                        <rect
                          key={keyId}
                          x={PAD + i * barW + 1}
                          y={y}
                          width={Math.max(1, barW - 3)}
                          height={Math.max(0.5, h)}
                          rx={1.5}
                          fill={colorOf(keyId)}
                        />
                      )
                    })}
                  </g>
                )
              })}
            </svg>
            <div className="chart-legend">
              {keyIds.map((keyId) => (
                <button
                  key={keyId}
                  className={`legend-chip${hidden.has(keyId) ? ' is-off' : ''}`}
                  onClick={() =>
                    setHidden((prev) => {
                      const next = new Set(prev)
                      if (next.has(keyId)) next.delete(keyId)
                      else next.add(keyId)
                      return next
                    })
                  }
                >
                  <span className="legend-chip__dot" style={{ background: colorOf(keyId) }} />
                  {stats.keyLabels[keyId] ?? keyId}
                </button>
              ))}
            </div>
          </>
        ) : (
          <EmptyState icon={<BarChart3 size={36} />} title="Поки що немає даних" />
        )}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="table">
          <thead>
            <tr>
              <th>{t.date}</th>
              <th>{t.session}</th>
              <th>{t.chunksCol}</th>
              <th>{t.status}</th>
            </tr>
          </thead>
          <tbody>
            {summaries.slice(0, 30).map((chat) => (
              <tr
                key={chat.id}
                style={{ cursor: 'pointer' }}
                onClick={() => useUiStore.getState().openChat(chat.id)}
              >
                <td className="text-sm muted tnum">{fmtDateTime(chat.createdAt)}</td>
                <td>{chat.title}</td>
                <td className="tnum">
                  {chat.doneCount}/{chat.chunkCount}
                </td>
                <td>
                  <Badge
                    tone={
                      chat.status === 'done'
                        ? 'success'
                        : chat.status === 'running'
                          ? 'accent'
                          : chat.status === 'partial'
                            ? 'warning'
                            : 'neutral'
                    }
                  >
                    {chat.status === 'done'
                      ? t.statusDone
                      : chat.status === 'running'
                        ? t.statusRunning
                        : chat.status === 'partial'
                          ? t.statusFailed
                          : chat.status}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {tooltip ? (
        <div className="chart-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          <strong>{tooltip.day}</strong>
          {tooltip.lines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
