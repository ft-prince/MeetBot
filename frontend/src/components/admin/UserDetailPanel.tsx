import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { fmtDate, fmtDuration } from '../../lib/format'
import type { AdminUserDetail, PlanId } from '../../lib/types'

const PLAN_OPTIONS: PlanId[] = ['free', 'pro', 'business']

interface UserDetailPanelProps {
  userId: string
  onClose: () => void
  /** Called after a successful plan change so the list behind can refresh. */
  onSaved: () => void
}

export function UserDetailPanel({ userId, onClose, onSaved }: UserDetailPanelProps) {
  const [detail, setDetail] = useState<AdminUserDetail | null>(null)
  const [plan, setPlan] = useState<PlanId>('free')
  const [planUntil, setPlanUntil] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    setError(null)
    api.adminUser(userId)
      .then(d => {
        if (cancelled) return
        setDetail(d)
        setPlan(d.user.plan)
        setPlanUntil(d.user.planUntil ? d.user.planUntil.slice(0, 10) : '')
      })
      .catch(err => { if (!cancelled) setError((err as Error).message) })
    return () => { cancelled = true }
  }, [userId])

  // Esc closes the panel — a slide-over with no keyboard exit is a trap.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const savePlan = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.adminSetPlan(userId, plan, planUntil || null)
      setSavedAt(Date.now())
      const fresh = await api.adminUser(userId)
      setDetail(fresh)
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const u = detail?.user
  const c = detail?.counts
  const downgraded = u && u.plan !== 'free' && u.effectivePlan === 'free'

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="relative w-full max-w-lg bg-white h-full overflow-y-auto shadow-xl">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-4 flex items-center justify-between">
          <div className="text-sm font-bold">User detail</div>
          <button onClick={onClose} className="p-1 rounded-md text-muted hover:bg-app-bg" aria-label="Close">
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {error && <div className="m-5 card p-3 border-danger text-danger text-xs">{error}</div>}

        {!detail || !u || !c ? (
          <p className="p-5 text-xs text-muted">Loading…</p>
        ) : (
          <div className="p-5 flex flex-col gap-5">

            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-accent-light text-accent flex items-center justify-center font-bold overflow-hidden">
                {u.picture ? <img src={u.picture} alt="" className="w-full h-full object-cover" /> : u.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold flex items-center gap-2">
                  {u.name}
                  {u.isAdmin && <span className="pill bg-accent-light text-accent">admin</span>}
                </div>
                <div className="text-xs text-muted truncate">{u.email}</div>
                <div className="text-[11px] text-muted">Joined {fmtDate(u.createdAt)}</div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Metric label="Meetings" value={c.meetingsTotal} />
              <Metric label="This month" value={`${c.meetingsThisMonth}${u.meetingsLimit === null ? '' : ` / ${u.meetingsLimit}`}`} />
              <Metric label="Recorded" value={fmtDuration(c.totalDurationMs)} />
              <Metric label="Email threads" value={c.emailThreads} />
              <Metric label="Action items" value={c.emailActionItems} />
              <Metric label="Upcoming" value={c.scheduledUpcoming} />
            </div>

            <div className="card p-4">
              <div className="text-sm font-bold mb-3">Plan</div>
              {downgraded && (
                <p className="text-xs text-warning mb-3">
                  Stored plan is <strong>{u.plan}</strong> but it expired — this account is being served as free.
                </p>
              )}
              <div className="flex flex-col gap-3">
                <label className="text-xs text-muted flex flex-col gap-1">
                  Plan
                  <select value={plan} onChange={e => setPlan(e.target.value as PlanId)} className="input text-xs">
                    {PLAN_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
                <label className="text-xs text-muted flex flex-col gap-1">
                  Expires on (blank = never)
                  <input type="date" value={planUntil} onChange={e => setPlanUntil(e.target.value)} className="input text-xs" />
                </label>
                <button onClick={savePlan} disabled={saving} className="btn btn-primary btn-sm justify-center">
                  {saving ? 'Saving…' : savedAt ? '✓ Saved' : 'Save plan'}
                </button>
                <p className="text-[11px] text-muted">
                  Limits in force: {u.meetingsLimit === null ? 'unlimited meetings' : `${u.meetingsLimit} meetings/month`},
                  {' '}email sync up to {u.emailSyncDays} days.
                </p>
              </div>
            </div>

            <div>
              <div className="text-sm font-bold mb-2">
                Recent meetings
                <span className="text-xs text-muted font-normal ml-2">
                  {c.lastMeetingAt ? `last ${fmtDate(c.lastMeetingAt)}` : 'none yet'}
                </span>
              </div>
              {detail.recentMeetings.length === 0 ? (
                <p className="text-xs text-muted">This user has not recorded a meeting.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-gray-200">
                  {detail.recentMeetings.map(m => (
                    <li key={m.id} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold truncate">{m.title || m.meetingCode}</div>
                        <div className="text-[11px] text-muted">{fmtDate(m.startedAt)}</div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {m.durationMs != null && (
                          <span className="text-[11px] text-muted">{fmtDuration(m.durationMs)}</span>
                        )}
                        {!m.endedAt ? (
                          <span className="pill pill-live">live</span>
                        ) : m.hasSummary ? (
                          <span className="pill pill-done">summary</span>
                        ) : (
                          <span className="pill pill-pending">no summary</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

          </div>
        )}
      </aside>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card p-3">
      <div className="text-[10px] font-bold text-muted uppercase tracking-widest">{label}</div>
      <div className="text-base font-extrabold mt-0.5">{value}</div>
    </div>
  )
}
