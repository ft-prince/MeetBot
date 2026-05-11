import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Topbar } from '../components/Topbar'
import { Toggle } from '../components/Toggle'
import { Pill } from '../components/Pill'
import { useAuth } from '../context/AuthContext'
import { useLiveMeetings } from '../hooks/useLiveMeetings'
import { api } from '../lib/api'
import { fmtDate, fmtTimeOfDay } from '../lib/format'
import type { CalendarEvent } from '../lib/types'

export function Calendar() {
  const { user } = useAuth()
  const { start } = useLiveMeetings()
  const navigate = useNavigate()
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [syncing, setSyncing] = useState(false)

  const load = async () => {
    if (!user) return
    try { setEvents((await api.listEvents()).events) } catch {}
  }
  useEffect(() => { load() }, [user])

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

  return (
    <>
      <Topbar
        title="Calendar"
        subtitle="Upcoming meetings from Google Calendar"
        right={<button onClick={sync} disabled={syncing} className="btn btn-primary btn-sm">{syncing ? 'Syncing…' : '🔄 Sync Calendar'}</button>}
      />
      <div className="p-8 flex-1">
        {!user ? (
          <div className="bg-accent-light border border-accent/20 rounded-lg px-4 py-3 text-sm text-amber-800">
            <strong>Connect your Google account</strong> to sync upcoming meetings and enable auto-join.
          </div>
        ) : events.length === 0 ? (
          <>
            <div className="bg-accent-light border border-accent/20 rounded-lg px-4 py-3 text-sm text-amber-800 mb-4">
              No upcoming Google Meet meetings found in the next 25 days.
            </div>
            <button onClick={sync} className="btn btn-primary btn-sm">🔄 Sync Calendar Now</button>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            {events.map(ev => {
              const start = new Date(ev.startTime)
              const attendees = (ev.attendees || []).slice(0, 3).map(a => a.name || a.email).join(', ') +
                ((ev.attendees || []).length > 3 ? ` +${ev.attendees.length - 3} more` : '')
              return (
                <div key={ev.id} className="card px-5 py-4 flex items-center gap-4 hover:shadow-card-hover transition-shadow">
                  <div className="flex-shrink-0 text-center bg-accent-light rounded-lg px-2.5 py-2 min-w-[64px]">
                    <div className="text-[10px] font-semibold text-accent uppercase">{fmtDate(start)}</div>
                    <div className="text-base font-bold text-accent">{fmtTimeOfDay(start)}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{ev.title}</div>
                    <div className="text-xs text-muted mt-0.5">👥 {attendees || 'No attendees'}</div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="flex items-center gap-1.5 text-xs text-muted">
                      <span>Auto-join</span>
                      <Toggle on={ev.autoJoin} onChange={() => toggleAutoJoin(ev)} />
                    </div>
                    {ev.meetingId
                      ? <Pill variant="live">● Live</Pill>
                      : <button onClick={() => joinNow(ev)} className="btn btn-success btn-sm">▶ Join</button>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
