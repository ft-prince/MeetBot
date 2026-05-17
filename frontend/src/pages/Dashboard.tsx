import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Topbar } from '../components/Topbar'
import { Pill } from '../components/Pill'
import { useAuth } from '../context/AuthContext'
import { useLiveMeetings } from '../hooks/useLiveMeetings'
import { api } from '../lib/api'
import { fmtDate, fmtDuration, fmtTimeOfDay, timeUntil } from '../lib/format'
import type { CalendarEvent, MeetingRow } from '../lib/types'

export function Dashboard() {
  const { user } = useAuth()
  const { start: startLive } = useLiveMeetings()
  const navigate = useNavigate()

  const [meetings, setMeetings] = useState<MeetingRow[]>([])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [url, setUrl] = useState("")
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [loadingMeetings, setLoadingMeetings] = useState(true)

  const load = async () => {
    setLoadingMeetings(true)
    try {
      const { meetings: list } = await api.listMeetings()
      setMeetings(list)
    } catch {
      // non-fatal
    } finally {
      setLoadingMeetings(false)
    }
    if (user) {
      try {
        const { events: evList } = await api.listEvents()
        setEvents(evList)
      } catch {}
    }
  }

  useEffect(() => { load() }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const completed = meetings.filter(m => m.ended_at).length
    const live = meetings.filter(m => !m.ended_at).length
    const summarised = meetings.filter(m => m.has_summary).length
    const totalMs = meetings.reduce((s, m) => s + (m.duration_ms || 0), 0)
    return { total: meetings.length, completed, live, summarised, hours: (totalMs / 3_600_000).toFixed(1) }
  }, [meetings])

  const upcoming = useMemo(() => {
    const now = Date.now()
    return events
      .filter(e => new Date(e.startTime).getTime() > now)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .slice(0, 5)
  }, [events])

  const recent = useMemo(() => meetings.filter(m => m.ended_at).slice(0, 10), [meetings])

  const greeting = (() => {
    const h = new Date().getHours()
    return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
  })()

  const join = async () => {
    const trimmed = url.trim()
    if (!trimmed) return
    const isGoogleMeet = trimmed.includes("meet.google.com")
    const isZoom = /zoom\.us\/j\/\d+/i.test(trimmed)
    if (!isGoogleMeet && !isZoom) {
      setJoinError('Please enter a valid Google Meet or Zoom link.')
      return
    }
    setJoinError(null)
    setJoining(true)
    try {
      const { meetingId } = await api.joinMeeting(trimmed)
      startLive(meetingId)
      setUrl("")
      navigate('/live')
    } catch (err) {
      setJoinError((err as Error).message)
    } finally {
      setJoining(false)
    }
  }

  return (
    <>
      <Topbar title="Dashboard" subtitle="Overview of your meetings" />
      <div className="p-4 sm:p-8 flex-1">
        <div className="mb-6">
          <h1 className="text-2xl font-extrabold mb-1">
            Good {greeting}, {user?.name?.split(" ")[0] || "there"}
          </h1>
          <p className="text-sm text-muted">Here's what's happening with your meetings.</p>
        </div>

        {/* Quick Join */}
        <div className="card p-5 mb-6">
          <div className="text-sm font-semibold mb-3 flex items-center gap-2">
            <svg width="16" height="16" fill="none" stroke="#F06428" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            Quick Join
          </div>
          <div className="flex flex-col sm:flex-row gap-2.5">
            <input
              className="input flex-1"
              type="url"
              placeholder="Paste Google Meet or Zoom link"
              value={url}
              onChange={e => { setUrl(e.target.value); setJoinError(null) }}
              onKeyDown={e => e.key === "Enter" && join()}
            />
            <button onClick={join} disabled={joining} className="btn btn-primary">
              {joining ? "Launching…" : "+ Start Recording"}
            </button>
          </div>
          {joinError && (
            <p className="mt-2 text-xs text-danger">{joinError}</p>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard label="Total Meetings" value={stats.total} sub={stats.completed + " completed"} />
          <StatCard label="Live Now" value={stats.live} sub={(stats.live !== 1 ? "active recordings" : "active recording")} valueClass={stats.live > 0 ? "text-success" : ""} />
          <StatCard label="AI Summaries" value={stats.summarised} sub="generated" valueClass="text-accent" />
          <StatCard label="Hours Recorded" value={stats.hours} sub="total recording time" />
        </div>

        {/* Two-column panels */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Panel
            title={<span className="flex items-center gap-1.5"><CalendarIcon />Upcoming Meetings</span>}
            action={user && <button onClick={async () => { await api.syncCalendar(); load() }} className="btn btn-secondary btn-sm">Sync</button>}
          >
            {!user ? (
              <Empty>
                <a href="/auth/google" className="text-accent font-semibold">Connect Google</a>
                <br />
                <span className="mt-1 block">to see upcoming meetings</span>
              </Empty>
            ) : upcoming.length === 0 ? (
              <Empty>
                No upcoming meetings found.
                <br />
                <button onClick={async () => { await api.syncCalendar(); load() }} className="btn btn-secondary btn-sm mt-3">Sync Calendar</button>
              </Empty>
            ) : upcoming.map(ev => {
              const evStart = new Date(ev.startTime)
              return (
                <DashItem
                  key={ev.id}
                  icon={<CalendarIcon />}
                  title={ev.title}
                  sub={fmtDate(evStart) + " · " + fmtTimeOfDay(evStart)}
                  right={<Pill variant="pending">{timeUntil(evStart)}</Pill>}
                  onClick={() => {
                    if (ev.meetingId) navigate("/meetings/" + ev.meetingId)
                    else navigate("/calendar")
                  }}
                />
              )
            })}
          </Panel>

          <Panel
            title={<span className="flex items-center gap-1.5"><ClockIcon />Recent Meetings</span>}
            action={<Link to="/meetings" className="btn btn-secondary btn-sm">View all</Link>}
          >
            {loadingMeetings ? (
              <div className="py-10 flex justify-center">
                <svg className="animate-spin text-accent" width="20" height="20" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            ) : recent.length === 0 ? (
              <Empty>No completed meetings yet.</Empty>
            ) : recent.map(m => (
              <DashItem
                key={m.id}
                icon={<DocIcon hasSummary={m.has_summary} />}
                title={m.title || m.meeting_code}
                sub={fmtDate(m.started_at) + " · " + fmtDuration(m.duration_ms)}
                right={<Pill variant={m.has_summary ? "done" : "pending"}>{m.has_summary ? "Done" : "Processing"}</Pill>}
                onClick={() => navigate("/meetings/" + m.id)}
              />
            ))}
          </Panel>
        </div>
      </div>
    </>
  )
}

function StatCard({ label, value, sub, valueClass = "" }: { label: string; value: string | number; sub: string; valueClass?: string }) {
  return (
    <div className="card p-4">
      <div className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">{label}</div>
      <div className={"text-3xl font-extrabold leading-tight " + valueClass}>{value}</div>
      <div className="text-[11px] text-muted mt-1">{sub}</div>
    </div>
  )
}

function Panel({ title, action, children }: { title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-200 flex items-center justify-between">
        <span className="text-sm font-bold flex items-center gap-1.5">{title}</span>
        {action}
      </div>
      <div>{children}</div>
    </div>
  )
}

function DashItem({ icon, title, sub, right, onClick }: {
  icon: React.ReactNode; title: string; sub: string; right?: React.ReactNode; onClick?: () => void
}) {
  return (
    <div onClick={onClick} className="px-5 py-3.5 border-b border-gray-200 last:border-b-0 flex items-center gap-3.5 cursor-pointer hover:bg-app-bg transition-colors">
      {icon}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold overflow-hidden text-ellipsis whitespace-nowrap">{title}</div>
        <div className="text-xs text-muted mt-0.5">{sub}</div>
      </div>
      {right && <div className="flex-shrink-0">{right}</div>}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-10 px-5 text-center text-muted text-sm">{children}</div>
}

function CalendarIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="#F06428" strokeWidth="2" viewBox="0 0 24 24">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function DocIcon({ hasSummary }: { hasSummary: boolean }) {
  return (
    <div className={"w-9 h-9 rounded-lg flex items-center justify-center " + (hasSummary ? "bg-emerald-100" : "bg-app-bg")}>
      <svg width="16" height="16" fill="none" stroke={hasSummary ? "#059669" : "#6B7280"} strokeWidth="2" viewBox="0 0 24 24">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14,2 14,8 20,8" />
        {hasSummary && <polyline points="9 13 12 16 15 13" />}
      </svg>
    </div>
  )
}