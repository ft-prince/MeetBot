import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Topbar } from '../components/Topbar'
import { Pill } from '../components/Pill'
import { api } from '../lib/api'
import { fmtDate, fmtDuration, fmtTimeOfDay } from '../lib/format'
import type { MeetingRow } from '../lib/types'

type StatusFilter = '' | 'done' | 'processing'
type SortKey = 'newest' | 'oldest' | 'longest' | 'shortest' | 'title' | 'participants'
type RangeKey = 'all' | '7d' | '30d' | '90d'

function dateInRange(d: string, range: RangeKey): boolean {
  if (range === 'all') return true
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
  return Date.now() - new Date(d).getTime() <= days * 86_400_000
}

function toCSV(rows: MeetingRow[]): string {
  const esc = (v: string | number | boolean | null | undefined) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const head = ['id', 'meeting_code', 'title', 'started_at', 'ended_at', 'duration_ms', 'has_summary', 'participants']
  const body = rows.map(r => [r.id, r.meeting_code, r.title || '', r.started_at, r.ended_at || '', r.duration_ms || 0, r.has_summary, (r.participants || []).join('; ')].map(esc).join(','))
  return [head.join(','), ...body].join('\n')
}

function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function AllMeetings() {
  const navigate = useNavigate()
  const [meetings, setMeetings] = useState<MeetingRow[]>([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('')
  const [range, setRange] = useState<RangeKey>('all')
  const [sort, setSort] = useState<SortKey>('newest')

  useEffect(() => {
    api.listMeetings().then(d => setMeetings(d.meetings)).catch(() => {})
  }, [])

  const filtered = useMemo(() => {
    let list = meetings.filter(m => m.ended_at)
    const q = query.toLowerCase().trim()
    if (q) list = list.filter(m =>
      (m.meeting_code || '').toLowerCase().includes(q) ||
      (m.title || '').toLowerCase().includes(q) ||
      (m.participants || []).some(p => p.toLowerCase().includes(q))
    )
    if (status === 'done') list = list.filter(m => m.has_summary)
    if (status === 'processing') list = list.filter(m => !m.has_summary)
    if (range !== 'all') list = list.filter(m => dateInRange(m.started_at, range))
    const sorted = [...list]
    const titleOf = (m: MeetingRow) => (m.title || m.meeting_code || '').toLowerCase()
    if (sort === 'oldest') sorted.sort((a, b) => +new Date(a.started_at) - +new Date(b.started_at))
    else if (sort === 'longest') sorted.sort((a, b) => (b.duration_ms || 0) - (a.duration_ms || 0))
    else if (sort === 'shortest') sorted.sort((a, b) => (a.duration_ms || 0) - (b.duration_ms || 0))
    else if (sort === 'title') sorted.sort((a, b) => titleOf(a).localeCompare(titleOf(b)))
    else if (sort === 'participants') sorted.sort((a, b) => (b.participants?.length || 0) - (a.participants?.length || 0))
    else sorted.sort((a, b) => +new Date(b.started_at) - +new Date(a.started_at))
    return sorted
  }, [meetings, query, status, range, sort])

  const summary = useMemo(() => {
    const totalMs = filtered.reduce((s, m) => s + (m.duration_ms || 0), 0)
    const summarized = filtered.filter(m => m.has_summary).length
    const completionPct = filtered.length > 0 ? Math.round((summarized / filtered.length) * 100) : 0
    return {
      count: filtered.length,
      hours: (totalMs / 3_600_000).toFixed(1),
      summarized,
      completionPct,
      avgDuration: filtered.length ? Math.round(totalMs / filtered.length) : 0,
    }
  }, [filtered])

  const exportCSV = () => {
    download(`meetmaster-meetings-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(filtered), 'text/csv')
  }
  const exportJSON = () => {
    download(`meetmaster-meetings-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(filtered, null, 2), 'application/json')
  }

  const hasFilters = !!query || !!status || range !== 'all' || sort !== 'newest'
  const clearFilters = () => { setQuery(''); setStatus(''); setRange('all'); setSort('newest') }

  return (
    <>
      <Topbar title="All Meetings" subtitle="Browse, search, and export your recorded meetings" />
      <div className="p-4 sm:p-8 flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <SummaryStat label="Showing" value={summary.count} />
          <SummaryStat label="Total Time" value={summary.hours + 'h'} />
          <SummaryStat label="Summarized" value={summary.summarized} sub={summary.completionPct + '% complete'} />
          <SummaryStat label="Avg Length" value={fmtDuration(summary.avgDuration)} />
        </div>

        <div className="card p-3.5 mb-4 flex flex-wrap items-center gap-2.5">
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by title, participant, or meeting code…"
            className="input flex-1 min-w-[200px] max-w-md"
          />
          <select value={range} onChange={e => setRange(e.target.value as RangeKey)} className="input w-auto cursor-pointer">
            <option value="all">All time</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
          <select value={status} onChange={e => setStatus(e.target.value as StatusFilter)} className="input w-auto cursor-pointer">
            <option value="">All status</option>
            <option value="done">Summarized</option>
            <option value="processing">Processing</option>
          </select>
          <select value={sort} onChange={e => setSort(e.target.value as SortKey)} className="input w-auto cursor-pointer">
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="longest">Longest first</option>
            <option value="shortest">Shortest first</option>
            <option value="title">Title (A–Z)</option>
            <option value="participants">Most participants</option>
          </select>
          {hasFilters && (
            <button onClick={clearFilters} className="btn btn-secondary btn-sm">Clear</button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={exportCSV} disabled={filtered.length === 0} className="btn btn-secondary btn-sm flex items-center gap-1">
              <ExportIcon /> CSV
            </button>
            <button onClick={exportJSON} disabled={filtered.length === 0} className="btn btn-secondary btn-sm flex items-center gap-1">
              <ExportIcon /> JSON
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-16 text-muted">
            <svg width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1" viewBox="0 0 24 24" className="mx-auto mb-3 text-gray-300">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14,2 14,8 20,8" />
            </svg>
            <p className="text-sm">No meetings match these filters.</p>
            {hasFilters && (
              <button onClick={clearFilters} className="btn btn-secondary btn-sm mt-3">Clear filters</button>
            )}
          </div>
        ) : (
          <>
            <div className="hidden sm:block card overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-app-bg border-b-2 border-gray-200">
                    <Th>Meeting</Th>
                    <Th>Date &amp; Time</Th>
                    <Th>Duration</Th>
                    <Th>Participants</Th>
                    <Th>Status</Th>
                    <Th>Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(m => (
                    <tr key={m.id} onClick={() => navigate('/meetings/' + m.id)} className="border-b border-gray-200 last:border-b-0 hover:bg-gray-50 cursor-pointer transition-colors">
                      <td className="px-4 py-3 align-middle">
                        <span className="font-bold text-ink text-sm">{m.title || m.meeting_code}</span>
                        <div className="text-xs text-muted mt-0.5 font-mono">{m.meeting_code}</div>
                      </td>
                      <td className="px-4 py-3 align-middle text-sm">
                        <span>{fmtDate(m.started_at)}</span>
                        <div className="text-xs text-muted">{fmtTimeOfDay(m.started_at)}</div>
                      </td>
                      <td className="px-4 py-3 align-middle text-sm text-muted">{fmtDuration(m.duration_ms)}</td>
                      <td className="px-4 py-3 align-middle text-sm text-muted">
                        {m.participants && m.participants.length > 0 ? (
                          <span title={m.participants.join(', ')}>
                            {m.participants.length} · <span className="text-xs">{m.participants.slice(0, 2).join(', ')}{m.participants.length > 2 ? '…' : ''}</span>
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <Pill variant={m.has_summary ? 'done' : 'pending'}>{m.has_summary ? 'Done' : 'Processing'}</Pill>
                      </td>
                      <td className="px-4 py-3 align-middle whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        <button onClick={() => navigate('/meetings/' + m.id)} className="btn btn-secondary btn-sm">View</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="sm:hidden flex flex-col gap-2">
              {filtered.map(m => (
                <MobileCard key={m.id} m={m} onClick={() => navigate('/meetings/' + m.id)} />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  )
}

function SummaryStat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card p-3.5">
      <div className="text-[10px] font-semibold text-muted uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-extrabold leading-tight mt-0.5">{value}</div>
      {sub && <div className="text-[10px] text-muted mt-0.5">{sub}</div>}
    </div>
  )
}

function MobileCard({ m, onClick }: { m: MeetingRow; onClick: () => void }) {
  return (
    <div onClick={onClick} className="card p-4 cursor-pointer hover:bg-gray-50 transition-colors flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="font-bold text-ink text-sm overflow-hidden text-ellipsis whitespace-nowrap">{m.title || m.meeting_code}</div>
        <div className="text-xs text-muted mt-0.5 font-mono">{m.meeting_code}</div>
        <div className="text-xs text-muted mt-1">
          {fmtDate(m.started_at)} · {fmtTimeOfDay(m.started_at)} · {fmtDuration(m.duration_ms)}
          {m.participants && m.participants.length > 0 ? ` · ${m.participants.length} participant${m.participants.length === 1 ? '' : 's'}` : ''}
        </div>
      </div>
      <Pill variant={m.has_summary ? 'done' : 'pending'}>{m.has_summary ? 'Done' : 'Processing'}</Pill>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-wider">{children}</th>
}

function ExportIcon() {
  return (
    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}
