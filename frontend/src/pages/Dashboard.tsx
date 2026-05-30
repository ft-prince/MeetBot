import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Topbar } from '../components/Topbar'
import { Pill } from '../components/Pill'
import { CreateMeetingModal } from '../components/CreateMeetingModal'
import { useAuth } from '../context/AuthContext'
import { useLiveMeetings } from '../hooks/useLiveMeetings'
import { api } from '../lib/api'
import { fmtDate, fmtDuration, fmtTimeOfDay, timeUntil } from '../lib/format'
import type { CalendarEvent, MeetingRow, ScheduledMeeting } from '../lib/types'

type UpcomingItem =
  | { kind: 'calendar'; id: string; title: string; startTime: string; meetingId: string | null }
  | { kind: 'scheduled'; id: string; title: string; startTime: string; scheduled: ScheduledMeeting }

export function Dashboard() {
  const { user } = useAuth()
  const { start: startLive } = useLiveMeetings()
  const navigate = useNavigate()

  const [meetings, setMeetings] = useState<MeetingRow[]>([])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [scheduled, setScheduled] = useState<ScheduledMeeting[]>([])
  const [url, setUrl] = useState("")
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [loadingMeetings, setLoadingMeetings] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [startingId, setStartingId] = useState<string | null>(null)

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
    try {
      const { scheduled: sList } = await api.listScheduledMeetings()
      setScheduled(sList)
    } catch {
      // non-fatal — endpoint may 401 before login
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
    const weekAgo = Date.now() - 7 * 86_400_000
    const completed = meetings.filter(m => m.ended_at).length
    const live = meetings.filter(m => !m.ended_at).length
    const summarised = meetings.filter(m => m.has_summary).length
    const thisWeek = meetings.filter(m => new Date(m.started_at).getTime() >= weekAgo).length
    const totalMs = meetings.reduce((s, m) => s + (m.duration_ms || 0), 0)
    const avgMs = completed > 0 ? Math.round(totalMs / completed) : 0
    const upcomingCount = scheduled.filter(s => s.status === 'scheduled' && new Date(s.scheduledFor).getTime() > Date.now()).length
    return {
      total: meetings.length,
      completed,
      live,
      summarised,
      thisWeek,
      hours: (totalMs / 3_600_000).toFixed(1),
      avgMs,
      upcomingCount,
    }
  }, [meetings, scheduled])

  const upcoming = useMemo<UpcomingItem[]>(() => {
    const now = Date.now()
    const fromCalendar: UpcomingItem[] = events
      .filter(e => new Date(e.startTime).getTime() > now)
      .map(e => ({ kind: 'calendar', id: e.id, title: e.title, startTime: e.startTime, meetingId: e.meetingId }))
    const fromScheduled: UpcomingItem[] = scheduled
      .filter(s => s.status === 'scheduled' && new Date(s.scheduledFor).getTime() > now - 60_000)
      .map(s => ({ kind: 'scheduled', id: s.id, title: s.title, startTime: s.scheduledFor, scheduled: s }))
    return [...fromCalendar, ...fromScheduled]
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .slice(0, 6)
  }, [events, scheduled])

  const startScheduled = async (id: string) => {
    setStartingId(id)
    try {
      const { meetingId } = await api.startScheduledMeeting(id)
      startLive(meetingId)
      navigate('/live')
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setStartingId(null)
    }
  }

  const cancelScheduled = async (id: string) => {
    if (!confirm('Cancel this scheduled meeting?')) return
    try {
      await api.cancelScheduledMeeting(id)
      load()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  const recent = useMemo(() => meetings.filter(m => m.ended_at).slice(0, 10), [meetings])

  const greeting = (() => {
    const h = new Date().getHours()
    return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
  })()

  const join = async () => {
    const trimmed = url.trim()
    if (!trimmed) return
    const isValidUrl = trimmed.includes('meet.google.com') || /zoom\.us\/(j|wc\/join)\/\d+/.test(trimmed)
    if (!isValidUrl) {
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

        {/* Quick Join + Schedule */}
        <div className="card p-4 sm:p-5 mb-6">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <div className="text-sm font-semibold flex items-center gap-2">
              <svg width="16" height="16" fill="none" stroke="#F06428" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
              </svg>
              Quick Join
            </div>
            <button onClick={() => setModalOpen(true)} className="btn btn-secondary btn-sm whitespace-nowrap">
              + Schedule
            </button>
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
          <StatCard label="Total Meetings" value={stats.total} sub={stats.thisWeek + " this week"} />
          <StatCard label="Live Now" value={stats.live} sub={(stats.live !== 1 ? "active recordings" : "active recording")} valueClass={stats.live > 0 ? "text-success" : ""} />
          <StatCard label="AI Summaries" value={stats.summarised} sub={stats.total ? Math.round((stats.summarised / stats.total) * 100) + "% complete" : "none yet"} valueClass="text-accent" />
          <StatCard label="Hours Recorded" value={stats.hours} sub={"avg " + fmtDuration(stats.avgMs)} />
          <StatCard label="Upcoming Scheduled" value={stats.upcomingCount} sub={stats.upcomingCount === 1 ? "meeting" : "meetings"} />
          <StatCard label="Completed" value={stats.completed} sub="all-time" />
          <StatCard label="Avg Length" value={fmtDuration(stats.avgMs)} sub="per meeting" />
          <StatCard label="Engagement" value={stats.total ? Math.round((stats.summarised / Math.max(1, stats.total)) * 100) + "%" : "—"} sub="summary rate" valueClass="text-accent" />
        </div>

        {/* Two-column panels */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Panel
            title={<span className="flex items-center gap-1.5"><CalendarIcon />Upcoming Meetings</span>}
            action={user && <button onClick={async () => { await api.syncCalendar(); load() }} className="btn btn-secondary btn-sm">Sync</button>}
          >
            {upcoming.length === 0 ? (
              <Empty>
                {!user ? (
                  <>
                    No scheduled meetings yet.
                    <br />
                    <span className="block mt-2">
                      <button onClick={() => setModalOpen(true)} className="btn btn-secondary btn-sm">+ Schedule one</button>
                      <span className="text-muted mx-2">or</span>
                      <a href="/auth/google" className="text-accent font-semibold">Connect Google</a>
                    </span>
                  </>
                ) : (
                  <>
                    No upcoming meetings found.
                    <br />
                    <span className="block mt-2 flex items-center justify-center gap-2">
                      <button onClick={() => setModalOpen(true)} className="btn btn-primary btn-sm">+ Schedule</button>
                      <button onClick={async () => { await api.syncCalendar(); load() }} className="btn btn-secondary btn-sm">Sync Calendar</button>
                    </span>
                  </>
                )}
              </Empty>
            ) : upcoming.map(item => {
              const evStart = new Date(item.startTime)
              if (item.kind === 'scheduled') {
                const isStarting = startingId === item.id
                return (
                  <DashItem
                    key={'s-' + item.id}
                    icon={<ScheduledIcon />}
                    title={item.title}
                    sub={fmtDate(evStart) + " · " + fmtTimeOfDay(evStart) + (item.scheduled.autoLaunch ? " · auto-launch" : "")}
                    right={
                      <div className="flex items-center gap-1.5">
                        <Pill variant="pending">{timeUntil(evStart)}</Pill>
                        <button
                          onClick={(e) => { e.stopPropagation(); startScheduled(item.id) }}
                          disabled={isStarting}
                          className="btn btn-primary btn-sm"
                        >
                          {isStarting ? "Starting…" : "Start"}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); cancelScheduled(item.id) }}
                          className="text-muted hover:text-danger p-1 rounded transition-colors"
                          aria-label="Cancel"
                          title="Cancel"
                        >
                          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    }
                  />
                )
              }
              return (
                <DashItem
                  key={'c-' + item.id}
                  icon={<CalendarIcon />}
                  title={item.title}
                  sub={fmtDate(evStart) + " · " + fmtTimeOfDay(evStart)}
                  right={<Pill variant="pending">{timeUntil(evStart)}</Pill>}
                  onClick={() => {
                    if (item.meetingId) navigate("/meetings/" + item.meetingId)
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
      <CreateMeetingModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={load}
      />
    </>
  )
}

function ScheduledIcon() {
  return (
    <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-accent-light">
      <svg width="16" height="16" fill="none" stroke="#F06428" strokeWidth="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    </div>
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