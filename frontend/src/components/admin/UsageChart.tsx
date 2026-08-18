import type { AdminSeriesPoint } from '../../lib/types'

// ponytail: hand-rolled SVG bars instead of a charting library. It's ~40 lines,
// has no bundle cost, and the day a stakeholder wants tooltips-with-crosshairs is
// the day to install Recharts — not before.
interface UsageChartProps {
  data: AdminSeriesPoint[]
  metric: keyof Pick<AdminSeriesPoint, 'signups' | 'meetings' | 'activeUsers'>
  title: string
  color?: string
}

export function UsageChart({ data, metric, title, color = '#2F55D4' }: UsageChartProps) {
  const values = data.map(d => d[metric])
  const max = Math.max(1, ...values)
  const total = values.reduce((a, b) => a + b, 0)
  const barGap = 2

  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between mb-4">
        <div className="text-sm font-bold">{title}</div>
        <div className="text-xs text-muted">{total} total · peak {max}/day</div>
      </div>

      {data.length === 0 ? (
        <p className="text-xs text-muted">No data yet.</p>
      ) : (
        <>
          <div className="flex items-end gap-[2px] h-28" style={{ gap: barGap }}>
            {data.map(point => {
              const value = point[metric]
              const heightPct = (value / max) * 100
              return (
                <div
                  key={point.day}
                  className="flex-1 rounded-t-sm transition-opacity hover:opacity-70 min-h-[2px]"
                  style={{ height: `${Math.max(heightPct, value > 0 ? 4 : 1)}%`, backgroundColor: value > 0 ? color : '#E5E7EB' }}
                  title={`${point.day}: ${value}`}
                />
              )
            })}
          </div>
          <div className="flex justify-between text-[10px] text-muted mt-2">
            <span>{fmtDay(data[0].day)}</span>
            <span>{fmtDay(data[data.length - 1].day)}</span>
          </div>
        </>
      )}
    </div>
  )
}

function fmtDay(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
