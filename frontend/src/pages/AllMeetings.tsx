import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Topbar } from '../components/Topbar'
import { Pill } from '../components/Pill'
import { api } from '../lib/api'
import { fmtDate, fmtDuration, fmtTimeOfDay } from '../lib/format'
import type { MeetingRow } from '../lib/types'

type StatusFilter = '' | 'done' | 'processing'
type SortKey = 'newest' | 'oldest' | 'longest'

export function AllMeetings() {
  const navigate = useNavigate()
  const [meetings, setMeetings] = useState<MeetingRow[]>([])
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<StatusFilter>("")
  const [sort, setSort] = useState<SortKey>('newest')

  useEffect(() => {
    api.listMeetings().then(d => setMeetings(d.meetings)).catch(() => {})
  }, [])

  const filtered = useMemo(() => {
    let list = meetings.filter(m => m.ended_at)
    const q = query.toLowerCase().trim()
    if (q) list = list.filter(m =>
      (m.meeting_code || "").toLowerCase().includes(q) || (m.title || "").toLowerCase().includes(q)
    )
    if (status === 'done') list = list.filter(m => m.has_summary)
    if (status === 'processing') list = list.filter(m => !m.has_summary)
    if (sort === 'oldest') list = [...list].sort((a, b) => +new Date(a.started_at) - +new Date(b.started_at))
    else if (sort === 'longest') list = [...list].sort((a, b) => (b.duration_ms || 0) - (a.duration_ms || 0))
    return list
  }, [meetings, query, status, sort])

  return (
    <>
      <Topbar title="All Meetings" subtitle="Browse and search all your recorded meetings" />
      <div className="p-4 sm:p-8 flex-1">
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by title or meeting code…" className="input max-w-md" />
          <select value={status} onChange={e => setStatus(e.target.value as StatusFilter)} className="input w-auto cursor-pointer">
            <option value="">All Status</option>
            <option value="done">Summarized</option>
            <option value="processing">Processing</option>
          </select>
          <select value={sort} onChange={e => setSort(e.target.value as SortKey)} className="input w-auto cursor-pointer">
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="longest">Longest First</option>
          </select>
          <span className="ml-auto text-sm text-muted font-medium">
            {filtered.length} meeting{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-16 text-muted">
            <svg width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1" viewBox="0 0 24 24" className="mx-auto mb-3 text-gray-300">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14,2 14,8 20,8" />
            </svg>
            <p className="text-sm">No meetings found.</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden sm:block card overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-app-bg border-b-2 border-gray-200">
                    <Th>Meeting</Th>
                    <Th>Date &amp; Time</Th>
                    <Th>Duration</Th>
                    <Th>Status</Th>
                    <Th>Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(m => (
                    <tr key={m.id} onClick={() => navigate("/meetings/" + m.id)} className="border-b border-gray-200 last:border-b-0 hover:bg-gray-50 cursor-pointer transition-colors">
                      <td className="px-4 py-3 align-middle">
                        <span className="font-mono font-bold text-accent text-sm">{m.meeting_code}</span>
                        {m.title && <div className="text-xs text-muted mt-0.5">{m.title}</div>}
                      </td>
                      <td className="px-4 py-3 align-middle text-sm">
                        <span>{fmtDate(m.started_at)}</span>
                        <div className="text-xs text-muted">{fmtTimeOfDay(m.started_at)}</div>
                      </td>
                      <td className="px-4 py-3 align-middle text-sm text-muted">{fmtDuration(m.duration_ms)}</td>
                      <td className="px-4 py-3 align-middle">
                        <Pill variant={m.has_summary ? "done" : "pending"}>{m.has_summary ? "Done" : "Processing"}</Pill>
                      </td>
                      <td className="px-4 py-3 align-middle whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        <button onClick={() => navigate("/meetings/" + m.id)} className="btn btn-secondary btn-sm">View</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden flex flex-col gap-2">
              {filtered.map(m => (
                <MobileCard key={m.id} m={m} onClick={() => navigate("/meetings/" + m.id)} />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  )
}

function MobileCard({ m, onClick }: { m: MeetingRow; onClick: () => void }) {
  return (
    <div onClick={onClick} className="card p-4 cursor-pointer hover:bg-gray-50 transition-colors flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="font-mono font-bold text-accent text-sm">{m.meeting_code}</div>
        {m.title && <div className="text-xs text-muted mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">{m.title}</div>}
        <div className="text-xs text-muted mt-1">{fmtDate(m.started_at)} · {fmtTimeOfDay(m.started_at)} · {fmtDuration(m.duration_ms)}</div>
      </div>
      <Pill variant={m.has_summary ? "done" : "pending"}>{m.has_summary ? "Done" : "Processing"}</Pill>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-wider">{children}</th>
}