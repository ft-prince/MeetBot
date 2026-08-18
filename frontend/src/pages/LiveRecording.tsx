import { Link } from 'react-router-dom'
import { Topbar } from '../components/Topbar'
import { LiveMeetingCard } from '../components/LiveMeetingCard'
import { useLiveMeetings } from '../hooks/useLiveMeetings'

// This page is the live transcript view, not a second way to start a meeting —
// the Quick Join form used to be duplicated here and on the Dashboard, which meant
// two places to fix whenever join behaviour changed. Joining lives on the Dashboard.
export function LiveRecording() {
  const { meetings } = useLiveMeetings()

  return (
    <>
      <Topbar title="Live Recording" subtitle="Real-time transcription with speaker identification" />
      <div className="p-3 sm:p-6 lg:p-8 flex-1 overflow-y-auto">
        {meetings.size === 0 ? (
          <div className="text-center py-16 text-muted">
            <div className="text-4xl mb-3">🎙</div>
            <p className="text-sm mb-4">No active recordings.</p>
            <Link to="/" className="btn btn-primary btn-sm">Start one from the Dashboard</Link>
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