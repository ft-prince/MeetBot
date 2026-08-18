import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Topbar } from '../components/Topbar'
import { Pill } from '../components/Pill'
import { AnalysisProgressPanel } from '../components/AnalysisProgress'
import { api } from '../lib/api'
import type { EmailFollowUp, EmailActionItem, EmailDailyBrief } from '../lib/types'

export function EmailDashboard() {
  const navigate = useNavigate()
  const [brief, setBrief] = useState<EmailDailyBrief | null>(null)
  const [followUps, setFollowUps] = useState<{
    pending: EmailFollowUp[]; overdue: EmailFollowUp[]; dueToday: EmailFollowUp[]; dueThisWeek: EmailFollowUp[]
  } | null>(null)
  const [actions, setActions] = useState<{
    open: EmailActionItem[]; completedCount: number; highPriority: EmailActionItem[]
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [detecting, setDetecting] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [b, f, a] = await Promise.all([
        api.emailDailyBrief(),
        api.getFollowUps(),
        api.getEmailActionItems(),
      ])
      setBrief(b)
      setFollowUps(f)
      setActions(a)
    } catch {
      // non-fatal
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

  const markFollowUpDone = async (id: string) => {
    await api.updateFollowUp(id, 'completed')
    await load()
  }

  const dismissFollowUp = async (id: string) => {
    await api.updateFollowUp(id, 'dismissed')
    await load()
  }

  const markActionDone = async (id: string) => {
    await api.updateEmailActionItem(id, 'completed')
    await load()
  }

  if (loading) {
    return (
      <>
        <Topbar title="Email Dashboard" subtitle="Follow-ups, action items, and daily brief" />
        <div className="p-8 flex justify-center">
          <svg className="animate-spin text-accent" width="24" height="24" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      </>
    )
  }

  return (
    <>
      <Topbar title="Email Dashboard" subtitle="Follow-ups, action items, and daily brief" />
      <div className="p-3 sm:p-6 lg:p-8 flex-1 overflow-y-auto">
        {/* Stats row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
          <StatCard label="Pending Follow-ups" value={followUps?.pending.length ?? 0} valueClass={followUps?.overdue.length ? 'text-danger' : ''} />
          <StatCard label="Overdue" value={followUps?.overdue.length ?? 0} valueClass="text-danger" />
          <StatCard label="Open Actions" value={actions?.open.length ?? 0} />
          <StatCard label="Completed" value={actions?.completedCount ?? 0} valueClass="text-success" />
        </div>

        {/* Analysis progress */}
        <AnalysisProgressPanel />

        {/* Daily Brief */}
        {brief && (
          <div className="card p-4 sm:p-5 mb-4 sm:mb-6 bg-gradient-to-r from-accent/5 to-amber-50">
            <div className="flex items-center gap-2 mb-3">
              <svg width="18" height="18" fill="none" stroke="#2F55D4" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
              <span className="text-sm font-bold">Daily Brief — {brief.date}</span>
            </div>
            <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed break-words">{brief.briefText}</pre>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          {/* Follow-ups panel */}
          <div className="card overflow-hidden">
            <div className="px-4 sm:px-5 py-3 sm:py-3.5 border-b border-gray-200 flex items-center justify-between gap-2">
              <span className="text-sm font-bold flex items-center gap-1.5">
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                </svg>
                Follow-ups
              </span>
              <button onClick={handleDetect} disabled={detecting} className="btn btn-secondary btn-sm whitespace-nowrap">
                {detecting ? 'Detecting…' : 'Detect New'}
              </button>
            </div>
            {(!followUps || followUps.pending.length === 0) ? (
              <div className="py-8 sm:py-10 text-center text-sm text-muted">No pending follow-ups</div>
            ) : (
              followUps.pending.slice(0, 10).map(f => (
                <div key={f.id} className="px-4 sm:px-5 py-3 border-b border-gray-200 last:border-b-0">
                  <div className="flex items-start sm:items-center gap-2 mb-1 flex-wrap">
                    <span
                      className="text-sm font-semibold text-accent cursor-pointer hover:underline break-words"
                      onClick={() => navigate(`/emails/${f.threadId}`)}
                    >
                      {f.subject}
                    </span>
                    {f.daysWaiting && f.daysWaiting > 5 && <Pill variant="pending">{f.daysWaiting}d</Pill>}
                  </div>
                  <div className="text-xs text-muted break-words">{f.reason}</div>
                  <div className="flex gap-1.5 mt-2">
                    <button onClick={() => markFollowUpDone(f.id)} className="btn btn-secondary btn-sm text-xs">Done</button>
                    <button onClick={() => dismissFollowUp(f.id)} className="btn btn-secondary btn-sm text-xs">Dismiss</button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Action Items panel */}
          <div className="card overflow-hidden">
            <div className="px-4 sm:px-5 py-3 sm:py-3.5 border-b border-gray-200 flex items-center justify-between">
              <span className="text-sm font-bold flex items-center gap-1.5">
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <polyline points="9 11 12 14 22 4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
                Action Items
              </span>
            </div>
            {(!actions || actions.open.length === 0) ? (
              <div className="py-8 sm:py-10 text-center text-sm text-muted">No open action items</div>
            ) : (
              actions.open.slice(0, 10).map(a => (
                <div key={a.id} className="px-4 sm:px-5 py-3 border-b border-gray-200 last:border-b-0">
                  <div className="flex items-start gap-2 mb-1">
                    <PriorityDot priority={a.priority} />
                    <span className="text-sm font-medium break-words">{a.task}</span>
                  </div>
                  <div className="text-xs text-muted flex flex-wrap items-center gap-1 sm:gap-2 ml-4">
                    <span
                      className="text-accent cursor-pointer hover:underline"
                      onClick={() => navigate(`/emails/${a.threadId}`)}
                    >
                      {a.subject}
                    </span>
                    {a.owner && <span className="hidden sm:inline">· {a.owner}</span>}
                    {a.dueHint && <span>· {a.dueHint}</span>}
                  </div>
                  <div className="flex gap-1.5 mt-2 ml-4">
                    <button onClick={() => markActionDone(a.id)} className="btn btn-secondary btn-sm text-xs">Complete</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="mt-4 text-center">
          <button onClick={() => navigate('/emails')} className="btn btn-secondary btn-sm">
            View All Emails
          </button>
        </div>
      </div>
    </>
  )
}

function StatCard({ label, value, valueClass = '' }: { label: string; value: number | string; valueClass?: string }) {
  return (
    <div className="card p-3 sm:p-4">
      <div className="text-[10px] sm:text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">{label}</div>
      <div className={'text-2xl sm:text-3xl font-extrabold leading-tight ' + valueClass}>{value}</div>
    </div>
  )
}

function PriorityDot({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    critical: 'bg-red-500',
    high: 'bg-amber-500',
    medium: 'bg-yellow-500',
    low: 'bg-gray-400',
  }
  return <span className={'w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ' + (colors[priority] || 'bg-gray-400')} />
}
