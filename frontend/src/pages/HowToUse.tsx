import { Link } from 'react-router-dom'
import { Topbar } from '../components/Topbar'

// ponytail: static content. Move to CMS/markdown only if non-devs need to edit it.
const STEPS: { title: string; body: string; to?: string; linkLabel?: string }[] = [
  {
    title: 'Connect your Google account',
    body: 'Sign in with Google so MeetMaster can read your calendar and dispatch the recording bot on your behalf. Nothing is recorded until you ask for it.',
    to: '/profile', linkLabel: 'Profile',
  },
  {
    title: 'Record a meeting right now',
    body: 'Paste a Google Meet, Zoom, or Teams link into Quick Join on the dashboard and hit Start Recording. The bot joins as "MeetMaster Recorder" and streams a live transcript.',
    to: '/', linkLabel: 'Dashboard',
  },
  {
    title: 'Or let auto-join handle it',
    body: 'Sync your calendar, then flip Auto Join on any event. The bot joins on its own when the meeting starts — you do not need the app open.',
    to: '/calendar', linkLabel: 'Calendar',
  },
  {
    title: 'Watch the transcript live',
    body: 'Live Recording shows speaker-attributed text as the meeting runs. You can leave the page; recording continues server-side.',
    to: '/live', linkLabel: 'Live Recording',
  },
  {
    title: 'Read the summary and action items',
    body: 'When a meeting ends, MeetMaster generates a summary, key insights, and action items, then emails a PDF report to you. Open any past meeting to read or re-download it.',
    to: '/meetings', linkLabel: 'All Meetings',
  },
  {
    title: 'Prepare with email context',
    body: 'Email Intelligence summarizes prior conversations with the people on your calendar, so you walk in already knowing the thread.',
    to: '/emails', linkLabel: 'Email Inbox',
  },
]

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Do participants know the meeting is being recorded?',
    a: 'Yes — the bot appears in the participant list as "MeetMaster Recorder" for the whole meeting.',
  },
  {
    q: 'Why did the bot not join my meeting?',
    a: 'Most often the meeting host had not admitted it from the waiting room, or the link changed after the calendar invite was sent. Report it from Help & Support and we can see the bot session log.',
  },
  {
    q: 'Can I record a meeting I am not hosting?',
    a: 'Yes, as long as you can share the join link and the host admits the bot.',
  },
  {
    q: 'How far back does email sync go?',
    a: 'You choose the window from the Email Inbox — 10, 15, or 30 days. Only threads inside that window are sent to the AI, which keeps sync fast and cheap. Older threads stay searchable; use "Analyze All" if you deliberately want them analyzed too.',
  },
]

export function HowToUse() {
  return (
    <>
      <Topbar title="How to Use" subtitle="Get from zero to your first transcript" />
      <div className="p-4 sm:p-8 flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto flex flex-col gap-6">

          <div className="card p-5 sm:p-6">
            <h2 className="text-base font-bold mb-1">Six steps to a fully documented meeting</h2>
            <p className="text-sm text-muted leading-relaxed">
              MeetMaster sends a bot into your calls, transcribes them with speaker labels, and turns
              the result into a summary with action items. Here is the whole workflow.
            </p>
          </div>

          <div className="card overflow-hidden">
            {STEPS.map((s, i) => (
              <div key={s.title} className="px-5 py-4 border-b border-gray-200 last:border-b-0 flex gap-4">
                <div className="w-7 h-7 rounded-md bg-accent-light text-accent flex items-center justify-center text-xs font-bold flex-shrink-0">
                  {i + 1}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold mb-1">{s.title}</div>
                  <p className="text-xs text-muted leading-relaxed">{s.body}</p>
                  {s.to && (
                    <Link to={s.to} className="inline-block mt-2 text-xs font-semibold text-accent hover:underline">
                      Go to {s.linkLabel} →
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-200 bg-app-bg text-sm font-bold">
              Frequently asked
            </div>
            {FAQ.map(f => (
              <div key={f.q} className="px-5 py-4 border-b border-gray-200 last:border-b-0">
                <div className="text-sm font-semibold mb-1">{f.q}</div>
                <p className="text-xs text-muted leading-relaxed">{f.a}</p>
              </div>
            ))}
          </div>

          <div className="card p-5 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-sm font-semibold">Still stuck?</div>
              <p className="text-xs text-muted">Send us the details and we will look at your session directly.</p>
            </div>
            <Link to="/help" className="btn btn-secondary btn-sm">Contact Support</Link>
          </div>

        </div>
      </div>
    </>
  )
}
