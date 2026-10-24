import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Topbar } from '../components/Topbar'
import { AnalysisProgressPanel } from '../components/AnalysisProgress'
import { api } from '../lib/api'
import type { EmailFollowUp, EmailActionItem, EmailDailyBrief } from '../lib/types'

const LIST_LIMIT = 10

type FollowUps = { pending: EmailFollowUp[]; overdue: EmailFollowUp[]; dueToday: EmailFollowUp[]; dueThisWeek: EmailFollowUp[] }
type Actions = { open: EmailActionItem[]; completedCount: number; highPriority: EmailActionItem[] }

export function EmailDashboard() {
  const navigate = useNavigate()
  const [brief, setBrief] = useState<EmailDailyBrief | null>(null)
  const [followUps, setFollowUps] = useState<FollowUps | null>(null)
  const [actions, setActions] = useState<Actions | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [detecting, setDetecting] = useState(false)

  const load = async () => {
    setLoadError('')
    try {
      const [b, f, a] = await Promise.all([api.emailDailyBrief(), api.getFollowUps(), api.getEmailActionItems()])
      setBrief(b)
      setFollowUps(f)
      setActions(a)
    } catch (err) {
      setLoadError((err as Error).message || 'Could not load your email dashboard.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleDetect = async () => {
    setDetecting(true)
    try {
      const { created } = await api.detectFollowUps()
      if (created > 0) await load()
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setDetecting(false)
    }
  }

  const setFollowUp = async (id: string, status: 'completed' | 'dismissed') => {
    await api.updateFollowUp(id, status)
    await load()
  }

  const completeAction = async (id: string) => {
    await api.updateEmailActionItem(id, 'completed')
    await load()
  }

  const overdueIds = new Set(followUps?.overdue.map(f => f.id))
  const pending = followUps?.pending ?? []
  const openActions = actions?.open ?? []
  const overdueCount = followUps?.overdue.length ?? 0

  return (
    <>
      <Topbar title="Email Dashboard" subtitle="Follow-ups, action items, and daily brief" />
      <div className="p-3 sm:p-6 lg:p-8 flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 flex justify-center"><Spinner /></div>
        ) : (
          <div className="max-w-6xl mx-auto flex flex-col gap-4 sm:gap-6">
            {loadError && <div role="alert" className="card p-3 text-sm text-danger border-danger">{loadError}</div>}

            {brief && <BriefHero brief={brief} overdue={overdueCount} openActions={openActions.length} />}

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <StatCard icon={<ClockIcon />} tone="accent" label="Waiting on reply" value={pending.length} hint="Threads you sent last" />
              <StatCard icon={<AlertIcon />} tone={overdueCount ? 'danger' : 'muted'} label="Overdue" value={overdueCount} hint="Past their follow-up date" />
              <StatCard icon={<ListIcon />} tone="amber" label="Open actions" value={openActions.length} hint="Tasks found in emails" />
              <StatCard icon={<CheckIcon />} tone="success" label="Completed" value={actions?.completedCount ?? 0} hint="Actions done" />
            </div>

            <AnalysisProgressPanel />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 items-start">
              <Panel
                title="Follow-ups"
                count={pending.length}
                action={
                  <button onClick={handleDetect} disabled={detecting} className="btn btn-secondary btn-sm whitespace-nowrap">
                    {detecting ? 'Detecting…' : 'Detect new'}
                  </button>
                }
              >
                {pending.length === 0 ? (
                  <EmptyState title="You're all caught up" text="No one is waiting on a reply from you." />
                ) : (
                  <ul>
                    {pending.slice(0, LIST_LIMIT).map(f => (
                      <FollowUpRow
                        key={f.id}
                        item={f}
                        overdue={overdueIds.has(f.id)}
                        onOpen={() => navigate(`/emails/${f.threadId}`)}
                        onDone={() => setFollowUp(f.id, 'completed')}
                        onDismiss={() => setFollowUp(f.id, 'dismissed')}
                      />
                    ))}
                  </ul>
                )}
                <MoreLink shown={LIST_LIMIT} total={pending.length} onClick={() => navigate('/emails')} />
              </Panel>

              <Panel title="Action items" count={openActions.length}>
                {openActions.length === 0 ? (
                  <EmptyState title="No open action items" text="Tasks people ask of you in email will show up here." />
                ) : (
                  <ul>
                    {openActions.slice(0, LIST_LIMIT).map(a => (
                      <ActionRow key={a.id} item={a} onOpen={() => navigate(`/emails/${a.threadId}`)} onComplete={() => completeAction(a.id)} />
                    ))}
                  </ul>
                )}
                <MoreLink shown={LIST_LIMIT} total={openActions.length} onClick={() => navigate('/emails')} />
              </Panel>
            </div>

            <div className="text-center">
              <button onClick={() => navigate('/emails')} className="btn btn-secondary btn-sm">View all emails</button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ─── Daily brief ─────────────────────────────────────────────────────────────

function BriefHero({ brief, overdue, openActions }: { brief: EmailDailyBrief; overdue: number; openActions: number }) {
  const date = new Date(brief.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
  const summary = overdue > 0
    ? `${overdue} follow-up${overdue === 1 ? ' is' : 's are'} overdue${openActions ? ` and ${openActions} action${openActions === 1 ? '' : 's'} need you` : ''}.`
    : openActions > 0
      ? `${openActions} action item${openActions === 1 ? '' : 's'} need${openActions === 1 ? 's' : ''} your attention.`
      : 'Nothing urgent today — your inbox is under control.'

  return (
    <div className="card overflow-hidden">
      <div className="p-5 sm:p-6 bg-gradient-to-br from-accent/10 via-white to-amber-50">
        <p className="text-xs font-semibold uppercase tracking-wider text-accent">Daily brief · {date}</p>
        <h2 className="mt-1.5 text-lg sm:text-xl font-bold text-ink">{summary}</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          <Chip tone="accent">{brief.newThreads} new in the last 24h</Chip>
          <Chip tone="amber">{brief.unrepliedCount} unread thread{brief.unrepliedCount === 1 ? '' : 's'}</Chip>
          <Chip tone={overdue ? 'danger' : 'muted'}>{brief.followUps.length} waiting on a reply</Chip>
        </div>
      </div>
    </div>
  )
}

// ─── Rows ────────────────────────────────────────────────────────────────────

function FollowUpRow({ item, overdue, onOpen, onDone, onDismiss }: {
  item: EmailFollowUp
  overdue: boolean
  onOpen: () => void
  onDone: () => void
  onDismiss: () => void
}) {
  return (
    <li className="group px-4 sm:px-5 py-3.5 border-b border-gray-100 last:border-b-0 hover:bg-app-bg/60 transition-colors">
      <div className="flex items-start gap-3">
        <span className={'mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ' + (overdue ? 'bg-danger' : 'bg-accent')} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <button onClick={onOpen} className="text-left text-sm font-semibold text-ink hover:text-accent break-words">
              {item.subject || '(no subject)'}
            </button>
            {item.daysWaiting != null && (
              <Chip tone={overdue ? 'danger' : 'muted'} small>{item.daysWaiting}d waiting</Chip>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted break-words">{item.reason}</p>
          <div className="mt-2 flex gap-1.5">
            <button onClick={onDone} className="btn btn-secondary btn-sm text-xs">✓ Done</button>
            <button onClick={onDismiss} className="btn btn-sm text-xs text-muted hover:bg-gray-100">Dismiss</button>
          </div>
        </div>
      </div>
    </li>
  )
}

const PRIORITY_TONE: Record<string, ChipTone> = { critical: 'danger', high: 'amber', medium: 'accent', low: 'muted' }

function ActionRow({ item, onOpen, onComplete }: { item: EmailActionItem; onOpen: () => void; onComplete: () => void }) {
  return (
    <li className="px-4 sm:px-5 py-3.5 border-b border-gray-100 last:border-b-0 hover:bg-app-bg/60 transition-colors">
      <div className="flex items-start gap-3">
        <button
          onClick={onComplete}
          aria-label={`Mark "${item.task}" complete`}
          className="mt-0.5 h-5 w-5 flex-shrink-0 rounded-full border-2 border-gray-300 hover:border-success hover:bg-emerald-50 transition-colors"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span className="text-sm font-medium text-ink break-words">{item.task}</span>
            <Chip tone={PRIORITY_TONE[item.priority] ?? 'muted'} small><span className="capitalize">{item.priority}</span></Chip>
          </div>
          <div className="mt-0.5 text-xs text-muted flex flex-wrap items-center gap-x-1.5">
            <button onClick={onOpen} className="text-accent hover:underline truncate max-w-full">{item.subject}</button>
            {item.owner && <span>· {item.owner}</span>}
            {item.dueHint && <span>· {item.dueHint}</span>}
          </div>
        </div>
      </div>
    </li>
  )
}

// ─── Building blocks ─────────────────────────────────────────────────────────

type ChipTone = 'accent' | 'amber' | 'danger' | 'success' | 'muted'
const CHIP: Record<ChipTone, string> = {
  accent: 'bg-accent-light text-accent',
  amber: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-danger',
  success: 'bg-emerald-100 text-success',
  muted: 'bg-gray-100 text-muted',
}

function Chip({ tone, small, children }: { tone: ChipTone; small?: boolean; children: ReactNode }) {
  return (
    <span className={'inline-flex flex-shrink-0 items-center rounded-full font-semibold whitespace-nowrap ' +
      (small ? 'px-2 py-0.5 text-[11px] ' : 'px-3 py-1 text-xs ') + CHIP[tone]}>
      {children}
    </span>
  )
}

function StatCard({ icon, tone, label, value, hint }: { icon: ReactNode; tone: ChipTone; label: string; value: number; hint: string }) {
  const valueColor = tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : 'text-ink'
  return (
    <div className="card p-4 flex items-start gap-3">
      <span className={'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ' + CHIP[tone]}>{icon}</span>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold text-muted uppercase tracking-wider">{label}</div>
        <div className={'text-2xl sm:text-3xl font-extrabold leading-tight tabular-nums ' + valueColor}>{value}</div>
        <div className="text-[11px] text-muted truncate">{hint}</div>
      </div>
    </div>
  )
}

function Panel({ title, count, action, children }: { title: string; count: number; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card overflow-hidden">
      <div className="px-4 sm:px-5 py-3.5 border-b border-gray-200 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold flex items-center gap-2">
          {title}
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-muted tabular-nums">{count}</span>
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="py-10 px-6 text-center">
      <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-success"><CheckIcon /></span>
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 text-xs text-muted">{text}</p>
    </div>
  )
}

function MoreLink({ shown, total, onClick }: { shown: number; total: number; onClick: () => void }) {
  if (total <= shown) return null
  return (
    <button onClick={onClick} className="w-full border-t border-gray-200 py-2.5 text-xs font-semibold text-accent hover:bg-app-bg">
      Show all {total} →
    </button>
  )
}

// ─── Icons ───────────────────────────────────────────────────────────────────

const iconProps = { width: 18, height: 18, fill: 'none', stroke: 'currentColor', strokeWidth: 2, viewBox: '0 0 24 24', 'aria-hidden': true }
function ClockIcon() { return <svg {...iconProps}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg> }
function AlertIcon() { return <svg {...iconProps}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg> }
function ListIcon() { return <svg {...iconProps}><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg> }
function CheckIcon() { return <svg {...iconProps}><polyline points="20 6 9 17 4 12" /></svg> }
function Spinner() {
  return (
    <svg className="animate-spin text-accent" width="24" height="24" fill="none" viewBox="0 0 24 24" aria-label="Loading">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}
