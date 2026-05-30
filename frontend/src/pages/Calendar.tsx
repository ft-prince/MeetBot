import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Topbar } from '../components/Topbar'
import { Toggle } from '../components/Toggle'
import { Pill } from '../components/Pill'
import { useAuth } from '../context/AuthContext'
import { useLiveMeetings } from '../hooks/useLiveMeetings'
import { api } from '../lib/api'
import { fmtDate, fmtTimeOfDay } from '../lib/format'
import type { CalendarEvent } from '../lib/types'

type EventStatus = 'live' | 'upcoming' | 'done'

function statusOf(ev: CalendarEvent, nowMs: number): EventStatus {
  const startMs = new Date(ev.startTime).getTime()
  const endMs = new Date(ev.endTime).getTime()
  if (nowMs < startMs) return 'upcoming'
  if (nowMs >= startMs && nowMs <= endMs) return 'live'
  return 'done'
}

export function Calendar() {
  const { user } = useAuth()
  const { start } = useLiveMeetings()
  const navigate = useNavigate()
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [syncing, setSyncing] = useState(false)
  const [now, setNow] = useState(Date.now())

  const load = async () => {
    if (!user) return
    try { setEvents((await api.listEvents()).events) } catch {}
  }
  useEffect(() => { load() }, [user])

  // Tick "now" once per minute so status pills update without a refresh
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const sync = async () => {
    if (!user) return alert('Connect your Google account first.')
    setSyncing(true)
    try {
      const { events } = await api.syncCalendar()
      setEvents(events)
    } catch (err) { alert((err as Error).message) }
    finally { setSyncing(false) }
  }

  const toggleAutoJoin = async (ev: CalendarEvent) => {
    const next = !ev.autoJoin
    setEvents(list => list.map(e => e.id === ev.id ? { ...e, autoJoin: next } : e))
    try { await api.setAutoJoin(ev.id, next) }
    catch { setEvents(list => list.map(e => e.id === ev.id ? { ...e, autoJoin: ev.autoJoin } : e)) }
  }

  const joinNow = async (ev: CalendarEvent) => {
    try {
      const { meetingId } = await api.joinMeeting(ev.meetUrl)
      start(meetingId)
      navigate('/live')
    } catch (err) { alert((err as Error).message) }
  }

  // Bucket events by status. Within each bucket, sort sensibly:
  //   live     → start_time ASC (oldest live first)
  //   upcoming → start_time ASC (soonest first)
  //   done     → start_time DESC (most-recent first)
  const { live, upcoming, past } = useMemo(() => {
    const live: CalendarEvent[] = []
    const upcoming: CalendarEvent[] = []
    const past: CalendarEvent[] = []
    for (const ev of events) {
      const s = statusOf(ev, now)
      if (s === 'live') live.push(ev)
      else if (s === 'upcoming') upcoming.push(ev)
      else past.push(ev)
    }
    const byStartAsc  = (a: CalendarEvent, b: CalendarEvent) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    const byStartDesc = (a: CalendarEvent, b: CalendarEvent) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    live.sort(byStartAsc)
    upcoming.sort(byStartAsc)
    past.sort(byStartDesc)
    return { live, upcoming, past }
  }, [events, now])

  return (
    <>
      <Topbar
        title="Calendar"
        subtitle="Past, live, and upcoming meetings from your Google Calendar"
        right={<button onClick={sync} disabled={syncing} className="btn btn-primary btn-sm whitespace-nowrap">{syncing ? 'Syncing…' : '🔄 Sync'}</button>}
      />
      <div className="p-4 sm:p-8 flex-1">
        {!user ? (
          <div className="bg-accent-light border border-accent/20 rounded-lg px-4 py-3 text-sm text-amber-800">
            <strong>Connect your Google account</strong> to sync upcoming meetings and enable auto-join.
          </div>
        ) : events.length === 0 ? (
          <>
            <div className="bg-accent-light border border-accent/20 rounded-lg px-4 py-3 text-sm text-amber-800 mb-4">
              No meetings found. Sync your Google Calendar to get started.
            </div>
            <button onClick={sync} className="btn btn-primary btn-sm">🔄 Sync Calendar Now</button>
          </>
        ) : (
          <div className="flex flex-col gap-8">
            {live.length > 0 && (
              <Section title="● Live Now" count={live.length}>
                {live.map(ev => <EventRow key={ev.id} ev={ev} status="live" onToggle={toggleAutoJoin} onJoin={joinNow} onOpen={(id) => navigate('/meetings/' + id)} />)}
              </Section>
            )}
            {upcoming.length > 0 && (
              <Section title="Upcoming" count={upcoming.length}>
                {upcoming.map(ev => <EventRow key={ev.id} ev={ev} status="upcoming" onToggle={toggleAutoJoin} onJoin={joinNow} onOpen={(id) => navigate('/meetings/' + id)} />)}
              </Section>
            )}
            {past.length > 0 && (
              <Section title="Past" count={past.length}>
                {past.map(ev => <EventRow key={ev.id} ev={ev} status="done" onToggle={toggleAutoJoin} onJoin={joinNow} onOpen={(id) => navigate('/meetings/' + id)} />)}
              </Section>
            )}
          </div>
        )}
      </div>
    </>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted">{title}</h3>
        <span className="text-[10px] font-bold text-muted bg-gray-100 rounded-full px-2 py-0.5">{count}</span>
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}

function EventRow({
  ev, status, onToggle, onJoin, onOpen,
}: {
  ev: CalendarEvent
  status: EventStatus
  onToggle: (ev: CalendarEvent) => void
  onJoin:   (ev: CalendarEvent) => void
  onOpen:   (meetingId: string) => void
}) {
  const start = new Date(ev.startTime)
  const attendeeList = (ev.attendees || []).filter(a => a.name || a.email)
  const attendees = attendeeList.slice(0, 3).map(a => a.name || a.email).join(', ') +
    (attendeeList.length > 3 ? ` +${attendeeList.length - 3} more` : '')
  const isClickable = ev.meetingId !== null

  return (
    <div
      className={
        'card px-4 py-3 sm:px-5 sm:py-4 flex flex-col sm:flex-row sm:items-center gap-3 transition-shadow ' +
        (isClickable ? 'cursor-pointer hover:shadow-card-hover' : 'hover:shadow-card-hover')
      }
      onClick={isClickable ? () => onOpen(ev.meetingId!) : undefined}
    >
      {/* Date + title row */}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="flex-shrink-0 text-center bg-accent-light rounded-lg px-2.5 py-2 min-w-[60px]">
          <div className="text-[10px] font-semibold text-accent uppercase">{fmtDate(start)}</div>
          <div className="text-sm font-bold text-accent">{fmtTimeOfDay(start)}</div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">{ev.title}</div>
          {attendees && (
            <div className="text-xs text-muted mt-0.5 truncate">👥 {attendees}</div>
          )}
        </div>
      </div>

      {/* Actions row — stopPropagation so clicks on buttons don't trigger the card open */}
      <div
        className="flex items-center gap-2 flex-shrink-0 flex-wrap"
        onClick={(e) => e.stopPropagation()}
      >
        {status === 'upcoming' && (
          <>
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <span>Auto-join</span>
              <Toggle on={ev.autoJoin} onChange={() => onToggle(ev)} />
            </div>
            <Pill variant="pending">Upcoming</Pill>
            <button onClick={() => onJoin(ev)} className="btn btn-success btn-sm">▶ Join</button>
          </>
        )}
        {status === 'live' && (
          <>
            <Pill variant="live">● Live</Pill>
            {ev.meetingId && (
              <button onClick={() => onOpen(ev.meetingId!)} className="btn btn-secondary btn-sm">View</button>
            )}
          </>
        )}
        {status === 'done' && (
          <>
            <Pill variant="done">✓ Done</Pill>
            {ev.meetingId && (
              <button onClick={() => onOpen(ev.meetingId!)} className="btn btn-secondary btn-sm">View</button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
