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
  const [url, setUrl] = useState('')
  const [joining, setJoining] = useState(false)

  const load = async () => {
    try {
      const { meetings } = await api.listMeetings()
      setMeetings(meetings)
    } catch {}
    if (user) {
      try {
        const { events } = await api.listEvents()
        setEvents(events)
      } catch {}
    }
  }

  useEffect(() => { load() }, [user])

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
    setJoining(true)
    try {
      const { meetingId } = await api.joinMeeting(trimmed)
      startLive(meetingId)
      setUrl('')
      navigate('/live')
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setJoining(false)
    }
  }

  return (
    <>
      <Topbar title="Dashboard" subtitle="Overview of your meetings" />
      <div className="p-8 flex-1">
        <div className="mb-6">
          <h1 className="text-2xl font-extrabold mb-1">
            Good {greeting}, {user?.name?.split(' ')[0] || 'there'} 👋
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
          <div className="flex gap-2.5">
            <input
              className="input flex-1 max-w-xl"
              type="url"
              placeholder="Paste Google Meet link — https://meet.google.com/abc-defg-hij"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && join()}
            />
            <button onClick={join} disabled={joining} className="btn btn-primary">
              {joining ? 'Launching…' : '+ Start Recording'}
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard label="Total Meetings" value={stats.total} sub={`${stats.completed} completed`} />
          <StatCard label="Live Now" value={stats.live} sub={`active recording${stats.live !== 1 ? 's' : ''}`} valueClass={stats.live > 0 ? 'text-success' : ''} />
          <StatCard label="AI Summaries" value={stats.summarised} sub="generated" valueClass="text-accent" />
          <StatCard label="Hours Recorded" value={stats.hours} sub="total recording time" />
        </div>

        {/* Two-column panels */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Panel
            title={<>📅 Upcoming Meetings</>}
            action={user && <button onClick={async () => { await api.syncCalendar(); load() }} className="btn btn-secondary btn-sm">🔄 Sync</button>}
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
                <button onClick={async () => { await api.syncCalendar(); load() }} className="btn btn-secondary btn-sm mt-3">🔄 Sync Calendar</button>
              </Empty>
            ) : upcoming.map(ev => {
              const evStart = new Date(ev.startTime)
              return (
                <DashItem
                  key={ev.id}
                  icon={<div className="w-9 h-9 rounded-lg bg-accent-light flex items-center justify-center">📅</div>}
                  title={ev.title}
                  sub={`${fmtDate(evStart)} · ${fmtTimeOfDay(evStart)}`}
                  right={<Pill variant="pending">{timeUntil(evStart)}</Pill>}
                  onClick={() => {
                    if (ev.meetingId) navigate(`/meetings/${ev.meetingId}`)
                    else navigate('/calendar')
                  }}
                />
              )
            })}
          </Panel>

          <Panel
            title={<>🕐 Recent Meetings</>}
            action={<Link to="/meetings" className="btn btn-secondary btn-sm">View all →</Link>}
          >
            {recent.length === 0 ? (
              <Empty>No completed meetings yet.</Empty>
            ) : recent.map(m => (
              <DashItem
                key={m.id}
                icon={
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${m.has_summary ? 'bg-emerald-100' : 'bg-app-bg'}`}>
                    {m.has_summary ? '🤖' : '📄'}
                  </div>
                }
                title={m.title || m.meeting_code}
                sub={`${fmtDate(m.started_at)} · ${fmtDuration(m.duration_ms)}`}
                right={<Pill variant={m.has_summary ? 'done' : 'pending'}>{m.has_summary ? 'Done' : 'Processing'}</Pill>}
                onClick={() => navigate(`/meetings/${m.id}`)}
              />
            ))}
          </Panel>
        </div>
      </div>
    </>
  )
}

function StatCard({ label, value, sub, valueClass = '' }: { label: string; value: string | number; sub: string; valueClass?: string }) {
  return (
    <div className="card p-4">
      <div className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-3xl font-extrabold leading-tight ${valueClass}`}>{value}</div>
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
    <div
      onClick={onClick}
      className="px-5 py-3.5 border-b border-gray-200 last:border-b-0 flex items-center gap-3.5 cursor-pointer hover:bg-app-bg transition-colors"
    >
      {icon}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate">{title}</div>
        <div className="text-xs text-muted mt-0.5">{sub}</div>
      </div>
      {right && <div className="flex-shrink-0">{right}</div>}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-10 px-5 text-center text-muted text-sm">{children}</div>
}
