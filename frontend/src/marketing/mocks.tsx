import type { MockName } from './content'
import { Icon, type IconName } from './icons'

/**
 * Product surfaces rendered as real DOM: the transcript panel, the summary
 * card, the calendar list, the email context view, the meeting library. They
 * mirror the app's actual screens so the marketing pages show the product
 * instead of describing it inside another box.
 *
 * ponytail: hardcoded sample content, no screenshots to keep in sync, no canvas.
 * Swap for real screenshots only if these drift from the app.
 */

interface FrameProps {
  title: string
  right?: string
  children: React.ReactNode
}

function Frame({ title, right, children }: FrameProps) {
  return (
    <div className="frame overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-4 py-2.5">
        <span className="text-[12px] font-medium text-slate-600">{title}</span>
        {right && <span className="font-mono text-[11px] text-slate-500">{right}</span>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

/* ── Small parts shared by several surfaces ──────────────────────────────── */

/** Initials, not photographs — nobody in these mockups is a real person. */
const AVATAR_TONES = ['bg-accent', 'bg-emerald-700', 'bg-slate-600', 'bg-amber-700']

export function Avatars({ names, extra }: { names: string[]; extra?: number }) {
  return (
    <div className="flex items-center">
      {names.map((n, i) => (
        <span
          key={n}
          title={n}
          className={`-ml-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-[10px] font-semibold text-white first:ml-0 ${AVATAR_TONES[i % AVATAR_TONES.length]}`}
        >
          {n.split(' ').map(p => p[0]).join('').slice(0, 2)}
        </span>
      ))}
      {extra ? (
        <span className="-ml-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-slate-200 text-[10px] font-semibold text-slate-600">
          +{extra}
        </span>
      ) : null}
    </div>
  )
}

/** Live audio meter. Purely decorative — the "Recording" label carries meaning. */
const WAVE = [0.35, 0.7, 1, 0.55, 0.85, 0.4, 0.95, 0.6, 0.3, 0.75, 0.5, 0.9, 0.45, 0.65, 0.35]

export function Waveform({ className = '' }: { className?: string }) {
  return (
    <span className={`flex h-5 items-center gap-[3px] ${className}`} aria-hidden="true">
      {WAVE.map((h, i) => (
        <span
          key={i}
          className="wave-bar w-[3px] rounded-full bg-accent/70"
          style={{ height: `${Math.round(h * 20)}px`, animationDelay: `${i * 90}ms` }}
        />
      ))}
    </span>
  )
}

/** Status pill used across the surfaces — one shape, four meanings. */
export function Pill({ tone, children }: { tone: 'live' | 'done' | 'work' | 'idle'; children: React.ReactNode }) {
  const tones = {
    live: 'bg-red-50 text-danger',
    done: 'bg-emerald-50 text-success',
    work: 'bg-amber-50 text-warning',
    idle: 'bg-slate-100 text-slate-600',
  }
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.06em] ${tones[tone]}`}>
      {children}
    </span>
  )
}

const LINES: { who: string; at: string; colour: string; said: string }[] = [
  { who: 'Priya Raman', at: '14:02:11', colour: 'text-accent', said: 'We should ship the export endpoint before the audit.' },
  { who: 'Marcus Hale', at: '14:02:19', colour: 'text-success', said: 'Agreed. I will have the schema ready Thursday.' },
  { who: 'Priya Raman', at: '14:02:26', colour: 'text-accent', said: 'Then let us hold the announcement until it is verified.' },
]

export function TranscriptMock() {
  return (
    <Frame title="Live transcript" right="Weekly product sync">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="h-1.5 w-1.5 animate-pulse-slow rounded-full bg-danger" aria-hidden="true" />
        <span className="text-[11px] font-semibold uppercase tracking-[.08em] text-danger">Recording</span>
        <Waveform className="ml-1" />
        <span className="ml-auto font-mono text-[11px] text-slate-500">00:12:41</span>
      </div>
      <div className="mb-3 flex items-center gap-2 border-b border-slate-100 pb-3">
        <Avatars names={['Priya Raman', 'Marcus Hale', 'Dan Okafor']} extra={2} />
        <span className="text-[11px] text-slate-500">5 participants</span>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-500">
          <Icon name="video" size={13} className="text-slate-400" />
          Google Meet
        </span>
      </div>
      <ul className="flex flex-col divide-y divide-slate-100">
        {LINES.map(l => (
          <li key={l.at} className="py-3 first:pt-0">
            <div className="flex items-baseline gap-2">
              <span className={`text-[13px] font-semibold ${l.colour}`}>{l.who}</span>
              <span className="font-mono text-[10px] text-slate-500">{l.at}</span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-ink">{l.said}</p>
          </li>
        ))}
        <li className="flex items-baseline gap-2 py-3">
          <span className="text-[13px] font-semibold text-slate-500">Marcus Hale</span>
          <span className="caret text-sm italic text-slate-500">one more thing before we</span>
        </li>
      </ul>
    </Frame>
  )
}

export function SummaryMock() {
  return (
    <Frame title="Meeting summary" right="generated 14:41">
      <div className="mb-3 flex items-center gap-2 border-b border-slate-100 pb-3">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent-light text-accent">
          <Icon name="sparkles" size={13} />
        </span>
        <span className="text-[11px] font-medium text-slate-600">Analysis complete</span>
        <Pill tone="done">Ready</Pill>
        <span className="ml-auto font-mono text-[11px] text-slate-500">42 min call</span>
      </div>
      <p className="text-sm leading-relaxed text-ink">
        The team agreed to ship the data export endpoint ahead of the compliance audit and to delay the
        public announcement until the export has been verified end to end.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {['Ship export first', 'Delay announcement'].map(d => (
          <span key={d} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
            Decision · {d}
          </span>
        ))}
      </div>
      <p className="mt-5 text-[11px] font-semibold uppercase tracking-[.08em] text-slate-500">Action items</p>
      <ul className="mt-2.5 flex flex-col gap-2.5">
        {[
          ['Marcus Hale', 'Export schema ready', 'Thu'],
          ['Priya Raman', 'Hold announcement until verified', '—'],
        ].map(([who, what, due]) => (
          <li key={what} className="flex items-start gap-2.5">
            <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-[4px] border border-slate-300" aria-hidden="true" />
            <span className="flex-1 text-sm text-ink">{what}</span>
            <span className="whitespace-nowrap text-[11px] font-medium text-accent">{who.split(' ')[0]}</span>
            <span className="w-7 text-right font-mono text-[11px] text-slate-500">{due}</span>
          </li>
        ))}
      </ul>
    </Frame>
  )
}

export function CalendarMock() {
  const rows: { time: string; title: string; platform: string; on: boolean }[] = [
    { time: '09:30', title: 'Design review', platform: 'Meet', on: true },
    { time: '11:00', title: 'Customer call — Northwind', platform: 'Zoom', on: true },
    { time: '15:30', title: '1:1 with Marcus', platform: 'Teams', on: false },
  ]
  return (
    <Frame title="Today" right="auto-join on">
      <ul className="flex flex-col divide-y divide-slate-100">
        {rows.map(r => (
          <li key={r.time} className="flex items-center gap-3 py-3 first:pt-0">
            <span className="w-11 font-mono text-xs text-slate-500">{r.time}</span>
            <span className="flex-1 truncate text-sm text-ink">{r.title}</span>
            <span className="text-[11px] font-medium text-slate-500">{r.platform}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.06em] ${
                r.on ? 'bg-accent-light text-accent' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {r.on ? 'Joining' : 'Skipped'}
            </span>
          </li>
        ))}
      </ul>
    </Frame>
  )
}

export function EmailMock() {
  const rows: { from: string; subject: string; flag: string; warn?: boolean }[] = [
    { from: 'Northwind procurement', subject: 'Re: pricing for 40 seats', flag: 'Waiting on you', warn: true },
    { from: 'Marcus Hale', subject: 'Export schema draft', flag: 'Context for 11:00' },
    { from: 'Legal', subject: 'Audit evidence checklist', flag: 'Follow-up due' },
  ]
  return (
    <Frame title="Email intelligence" right="last 30 days">
      <ul className="flex flex-col divide-y divide-slate-100">
        {rows.map(r => (
          <li key={r.subject} className="py-3 first:pt-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-[13px] font-semibold text-ink">{r.from}</span>
              <span
                className={`ml-auto whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.06em] ${
                  r.warn ? 'bg-amber-50 text-warning' : 'bg-accent-light text-accent'
                }`}
              >
                {r.flag}
              </span>
            </div>
            <p className="mt-0.5 truncate text-sm text-slate-600">{r.subject}</p>
          </li>
        ))}
      </ul>
    </Frame>
  )
}

/** The emailed report: what lands in the inbox after a call. */
export function ReportMock() {
  const actions: { done: boolean; what: string; who: string; due: string }[] = [
    { done: true, what: 'Prepare the export schema', who: 'Marcus', due: 'Thu' },
    { done: false, what: 'Hold announcement until verified', who: 'Priya', due: 'Fri' },
    { done: false, what: 'Send audit checklist to Legal', who: 'Dan', due: 'Mon' },
  ]
  return (
    <Frame title="Meeting report" right="sent 14:43">
      <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent-light text-accent">
          <Icon name="mail" size={13} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-slate-600">
          Weekly product sync — summary and action items
        </span>
        <Pill tone="done">PDF</Pill>
      </div>
      <p className="mt-3.5 text-[11px] font-semibold uppercase tracking-[.08em] text-slate-500">Action items</p>
      <ul className="mt-2.5 flex flex-col gap-2.5">
        {actions.map(a => (
          <li key={a.what} className="flex items-center gap-2.5">
            {a.done ? (
              <Icon name="checkCircle" size={15} className="shrink-0 text-success" />
            ) : (
              <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-slate-300" aria-hidden="true" />
            )}
            <span className={`flex-1 text-[13px] ${a.done ? 'text-slate-500 line-through' : 'text-ink'}`}>{a.what}</span>
            <span className="text-[11px] font-medium text-accent">{a.who}</span>
            <span className="w-7 text-right font-mono text-[11px] text-slate-500">{a.due}</span>
          </li>
        ))}
      </ul>
    </Frame>
  )
}

export function LibraryMock() {
  const rows = [
    { title: 'Weekly product sync', when: 'Today · 14:00', platform: 'Meet', items: '2 actions' },
    { title: 'Northwind — renewal', when: 'Yesterday · 11:00', platform: 'Zoom', items: '5 actions' },
    { title: 'Candidate — backend', when: 'Mon · 16:30', platform: 'Teams', items: '1 action' },
  ]
  return (
    <Frame title="Meetings" right="128 recorded">
      <div className="mb-4 flex items-center gap-2 rounded-btn border border-slate-200 px-3 py-2 text-slate-500">
        <Icon name="search" size={15} />
        <span className="text-[13px]">Search by title, participant, or meeting code…</span>
      </div>
      <ul className="flex flex-col divide-y divide-slate-100">
        {rows.map(r => (
          <li key={r.title} className="py-3 first:pt-0">
            <div className="flex items-center gap-2">
              <span className="flex-1 truncate text-sm font-medium text-ink">{r.title}</span>
              <span className="text-[11px] font-medium text-slate-500">{r.platform}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[12px] text-slate-500">
              <span>{r.when}</span>
              <span aria-hidden="true">·</span>
              <span>{r.items}</span>
            </div>
          </li>
        ))}
      </ul>
    </Frame>
  )
}

/**
 * The usage counter from the dashboard. Pricing is entirely about this number,
 * so the pricing page shows the thing being counted.
 */
export function UsageMock() {
  const months = [
    { label: 'Recorded this month', used: 62, limit: 100 },
    { label: 'Email sync window', used: 30, limit: 30, unit: 'days' },
  ]
  return (
    <Frame title="Usage" right="resets on the 1st">
      <ul className="flex flex-col gap-4">
        {months.map(m => (
          <li key={m.label}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px] text-slate-600">{m.label}</span>
              <span className="font-mono text-[13px] font-medium text-ink">
                {m.used}
                <span className="text-slate-500"> / {m.limit}{m.unit ? ` ${m.unit}` : ''}</span>
              </span>
            </div>
            <span className="mt-2 block h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <span
                className="block h-full rounded-full bg-accent"
                style={{ width: `${Math.round((m.used / m.limit) * 100)}%` }}
              />
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3.5">
        <Icon name="checkCircle" size={14} className="text-success" />
        <span className="text-[12px] text-slate-600">Enforced server-side, counted from your meetings</span>
      </div>
    </Frame>
  )
}

/**
 * The full application shell — sidebar, usage, a live meeting, and the recent
 * meetings list. This is the one surface big enough to answer "what does it
 * actually look like", so it carries the hero and the showcase section.
 *
 * ponytail: a single composed mock rather than five stitched screenshots. The
 * sidebar labels and counters mirror src/components/Sidebar.tsx and the usage
 * card; keep them in step if the app's navigation changes.
 */
const NAV_ITEMS: { icon: IconName; label: string; active?: boolean }[] = [
  { icon: 'barChart', label: 'Dashboard', active: true },
  { icon: 'mic', label: 'Live' },
  { icon: 'calendar', label: 'Calendar' },
  { icon: 'fileText', label: 'Meetings' },
  { icon: 'mail', label: 'Emails' },
]

const RECENT = [
  { title: 'Weekly product sync', when: 'Today · 14:00', people: ['Priya Raman', 'Marcus Hale'], extra: 3, state: 'done' as const, label: 'Summarised' },
  { title: 'Northwind — renewal', when: 'Today · 11:00', people: ['Dan Okafor', 'Priya Raman'], extra: 1, state: 'work' as const, label: 'Analysing' },
  { title: 'Candidate — backend', when: 'Mon · 16:30', people: ['Marcus Hale'], state: 'done' as const, label: 'Summarised' },
]

export function DashboardMock() {
  return (
    <div className="frame-lg overflow-hidden">
      {/* Window chrome — signals "application", not "web page". */}
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        </span>
        <span className="mx-auto rounded-full bg-white px-3 py-1 text-[11px] text-slate-500 ring-1 ring-slate-200">
          app.meetmaster.example / dashboard
        </span>
      </div>

      <div className="flex">
        {/* Sidebar */}
        <div className="hidden w-44 shrink-0 flex-col border-r border-slate-200 bg-slate-50/70 p-3 sm:flex">
          <div className="mb-4 flex items-center gap-2 px-1">
            <span className="flex h-6 w-6 items-center justify-center rounded-btn bg-accent text-[11px] font-bold text-white">M</span>
            <span className="text-[13px] font-semibold text-ink">MeetMaster</span>
          </div>
          <ul className="flex flex-col gap-0.5">
            {NAV_ITEMS.map(item => (
              <li
                key={item.label}
                className={`flex items-center gap-2 rounded-btn px-2 py-1.5 text-[12px] ${
                  item.active ? 'bg-accent-light font-medium text-accent' : 'text-slate-600'
                }`}
              >
                <Icon name={item.icon} size={14} />
                {item.label}
              </li>
            ))}
          </ul>
          <div className="mt-auto rounded-btn border border-slate-200 bg-white p-2.5">
            <p className="text-[10px] font-medium uppercase tracking-[.08em] text-slate-500">This month</p>
            <p className="mt-1 text-[13px] font-semibold text-ink">
              62<span className="font-normal text-slate-500"> / 100</span>
            </p>
            <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <span className="block h-full w-[62%] rounded-full bg-accent" />
            </span>
          </div>
        </div>

        {/* Main pane */}
        <div className="min-w-0 flex-1 p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-ink">Good afternoon, Priya</p>
              <p className="text-[12px] text-slate-500">3 meetings today · 2 already summarised</p>
            </div>
            <span className="ml-auto hidden items-center gap-1.5 rounded-btn border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-500 sm:flex">
              <Icon name="search" size={13} />
              Search meetings
            </span>
          </div>

          {/* Live meeting — the state that only this product has */}
          <div className="mt-4 rounded-card border border-accent/25 bg-accent-light/40 p-3.5">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 animate-pulse-slow rounded-full bg-danger" aria-hidden="true" />
              <span className="text-[11px] font-semibold uppercase tracking-[.08em] text-danger">Live</span>
              <Waveform className="ml-1" />
              <span className="ml-auto font-mono text-[11px] text-slate-600">00:12:41</span>
            </div>
            <p className="mt-2.5 truncate text-[13px] font-medium text-ink">Weekly product sync</p>
            <div className="mt-2 flex items-center gap-2">
              <Avatars names={['Priya Raman', 'Marcus Hale', 'Dan Okafor']} extra={2} />
              <span className="text-[11px] text-slate-600">Transcribing live</span>
            </div>
            <p className="mt-2.5 border-t border-accent/15 pt-2.5 text-[12px] leading-relaxed text-slate-600">
              <span className="font-medium text-accent">Marcus Hale</span>{' '}
              <span className="caret">I will have the export schema ready by</span>
            </p>
          </div>

          {/* Recent meetings */}
          <div className="mt-4">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[.08em] text-slate-500">Recent</p>
            <ul className="divide-y divide-slate-100 rounded-card border border-slate-200">
              {RECENT.map(m => (
                <li key={m.title} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-btn bg-slate-100 text-slate-500">
                    <Icon name="fileText" size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{m.title}</span>
                    <span className="block text-[11px] text-slate-500">{m.when}</span>
                  </span>
                  <span className="hidden sm:block">
                    <Avatars names={m.people} extra={m.extra} />
                  </span>
                  <Pill tone={m.state}>{m.label}</Pill>
                </li>
              ))}
            </ul>
          </div>

          {/* Processing strip — the AI state, shown honestly as "in progress" */}
          <div className="mt-3 flex items-center gap-2 rounded-card border border-slate-200 bg-slate-50/70 px-3 py-2.5">
            <Icon name="sparkles" size={14} className="text-accent" />
            <span className="text-[12px] text-slate-600">Generating summary and action items</span>
            <span className="ml-1 flex gap-1" aria-hidden="true">
              {[0, 1, 2].map(i => (
                <span key={i} className="think-dot h-1 w-1 rounded-full bg-accent" style={{ animationDelay: `${i * 180}ms` }} />
              ))}
            </span>
            <span className="ml-auto font-mono text-[11px] text-slate-500">~2 min</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Data files reference mocks by name; this is the only place that maps them. */
export const MOCKS: Record<MockName, () => JSX.Element> = {
  transcript: TranscriptMock,
  summary: SummaryMock,
  calendar: CalendarMock,
  email: EmailMock,
  library: LibraryMock,
  report: ReportMock,
  dashboard: DashboardMock,
}
