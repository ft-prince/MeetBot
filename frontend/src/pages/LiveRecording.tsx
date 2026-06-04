import { useState } from 'react'
import { Topbar } from '../components/Topbar'
import { LiveMeetingCard } from '../components/LiveMeetingCard'
import { useLiveMeetings } from '../hooks/useLiveMeetings'
import { api } from '../lib/api'

export function LiveRecording() {
  const { meetings, start } = useLiveMeetings()
  const [url, setUrl] = useState('')
  const [joining, setJoining] = useState(false)

  const join = async () => {
    const trimmed = url.trim()
    if (!trimmed) return
    setJoining(true)
    try {
      const { meetingId } = await api.joinMeeting(trimmed)
      start(meetingId)
      setUrl('')
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setJoining(false)
    }
  }

  return (
    <>
      <Topbar title="Live Recording" subtitle="Real-time transcription with speaker identification" />
      <div className="p-3 sm:p-6 lg:p-8 flex-1 overflow-y-auto">
        <div className="card p-3 sm:p-5 mb-4 sm:mb-6">
          <div className="text-sm font-semibold mb-3 flex items-center gap-2">
            <svg width="16" height="16" fill="none" stroke="#F06428" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            Start Recording
          </div>
          <div className="flex flex-col sm:flex-row gap-2.5">
            <input
              className="input flex-1"
              type="url"
              placeholder="Paste Google Meet, Zoom, or Teams link"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && join()}
            />
            <button onClick={join} disabled={joining} className="btn btn-primary flex-shrink-0 justify-center">
              {joining ? 'Launching…' : '+ Start Recording'}
            </button>
          </div>
        </div>

        {meetings.size === 0 ? (
          <div className="text-center py-16 text-muted">
            <div className="text-4xl mb-3">🎙</div>
            <p className="text-sm">No active recordings. Paste a Meet, Zoom, or Teams link above to start.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            {[...meetings.values()].map(m => <LiveMeetingCard key={m.id} meeting={m} />)}
          </div>
        )}
      </div>
    </>
  )
}