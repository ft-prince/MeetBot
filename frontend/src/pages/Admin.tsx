import { useCallback, useEffect, useState } from 'react'
import { Topbar } from '../components/Topbar'
import { UsageChart } from '../components/admin/UsageChart'
import { UserDetailPanel } from '../components/admin/UserDetailPanel'
import { api } from '../lib/api'
import type { AdminStats, AdminTimeseries, AdminUser, PlanId } from '../lib/types'

const PLAN_OPTIONS: PlanId[] = ['free', 'pro', 'business']
const RANGE_OPTIONS = [7, 30, 90]

// ponytail: charts are hand-rolled SVG bars and the only write action is the plan.
// Refunds, impersonation, and bulk email stay in psql/the provider dashboard until
// someone asks for them twice.
export function Admin() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [timeseries, setTimeseries] = useState<AdminTimeseries | null>(null)
  const [range, setRange] = useState(30)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = useCallback(async (q: string) => {
    setLoading(true)
    try {
      const [s, u] = await Promise.all([api.adminStats(), api.adminUsers(q)])
      setStats(s)
      setUsers(u.users)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load('') }, [load])

  // The chart range changes independently of the user search, so it reloads alone.
  useEffect(() => {
    let cancelled = false
    api.adminTimeseries(range)
      .then(t => { if (!cancelled) setTimeseries(t) })
      .catch(err => { if (!cancelled) setError((err as Error).message) })
    return () => { cancelled = true }
  }, [range])

  // Debounce the search so typing doesn't fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { load(query) }, 300)
    return () => clearTimeout(t)
  }, [query, load])

  const setPlan = async (user: AdminUser, plan: PlanId) => {
    setSavingId(user.id)
    const previous = users
    // Optimistic: reflect the change immediately, roll back if the write fails.
    setUsers(list => list.map(u => (u.id === user.id ? { ...u, plan } : u)))
    try {
      await api.adminSetPlan(user.id, plan)
      setError(null)
    } catch (err) {
      setUsers(previous)
      setError(`Could not change ${user.email}'s plan: ${(err as Error).message}`)
    } finally {
      setSavingId(null)
    }
  }

  return (
    <>
      <Topbar title="Admin" subtitle="Users, plans, and usage" />
      <div className="p-4 sm:p-8 flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto flex flex-col gap-6">

          {error && (
            <div className="card p-4 border-danger text-danger text-sm">{error}</div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Users" value={stats?.totalUsers} hint={stats && `${stats.newUsers30d} new in 30d`} />
            <StatCard label="Paid" value={stats?.paidUsers}
                      hint={stats && stats.totalUsers > 0 ? `${Math.round((stats.paidUsers / stats.totalUsers) * 100)}% conversion` : undefined} />
            <StatCard label="Active (30d)" value={stats?.activeUsers30d} hint="recorded a meeting" />
            <StatCard label="Live now" value={stats?.meetingsInProgress} hint="bots in meetings" />
            <StatCard label="Meetings" value={stats?.totalMeetings} hint={stats && `${stats.meetingsThisMonth} this month`} />
            <StatCard label="Minutes (month)" value={stats?.minutesThisMonth} hint="recorded audio" />
            <StatCard label="Failed summaries" value={stats?.failedSummaries30d} hint="ended, no summary (30d)"
                      alert={(stats?.failedSummaries30d ?? 0) > 0} />
            <StatCard label="Plans" value={undefined} hint={
              timeseries ? PLAN_OPTIONS.map(p => `${p}: ${timeseries.planCounts[p] ?? 0}`).join(' · ') : undefined
            } />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Range</span>
            {RANGE_OPTIONS.map(d => (
              <button
                key={d}
                onClick={() => setRange(d)}
                className={'btn btn-sm ' + (range === d ? 'btn-primary' : 'btn-secondary')}
              >
                {d}d
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <UsageChart title="Signups" metric="signups" data={timeseries?.series ?? []} color="#047857" />
            <UsageChart title="Meetings recorded" metric="meetings" data={timeseries?.series ?? []} />
            <UsageChart title="Active users" metric="activeUsers" data={timeseries?.series ?? []} color="#B45309" />
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <div className="text-sm font-bold">Users</div>
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search name or email"
                className="input text-xs w-56"
              />
            </div>

            {loading && users.length === 0 ? (
              <p className="text-xs text-muted">Loading…</p>
            ) : users.length === 0 ? (
              <p className="text-xs text-muted">No users match “{query}”.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted text-left">
                      <th className="py-2 pr-3 font-semibold">User</th>
                      <th className="py-2 pr-3 font-semibold">Plan</th>
                      <th className="py-2 pr-3 font-semibold">Meetings (month)</th>
                      <th className="py-2 pr-3 font-semibold">Total</th>
                      <th className="py-2 pr-3 font-semibold">Joined</th>
                      <th className="py-2 font-semibold sr-only">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => {
                      const overQuota = u.meetingsLimit !== null && u.meetingsThisMonth >= u.meetingsLimit
                      return (
                        <tr key={u.id} className="border-t border-gray-200">
                          <td className="py-2.5 pr-3">
                            <div className="font-semibold flex items-center gap-1.5">
                              {u.name}
                              {u.isAdmin && <span className="pill bg-accent-light text-accent">admin</span>}
                            </div>
                            <div className="text-muted">{u.email}</div>
                          </td>
                          <td className="py-2.5 pr-3">
                            <select
                              value={u.plan}
                              disabled={savingId === u.id}
                              onChange={e => setPlan(u, e.target.value as PlanId)}
                              className="input text-xs py-1"
                            >
                              {PLAN_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                          </td>
                          <td className={'py-2.5 pr-3 ' + (overQuota ? 'text-danger font-semibold' : '')}>
                            {u.meetingsThisMonth}{u.meetingsLimit === null ? '' : ` / ${u.meetingsLimit}`}
                          </td>
                          <td className="py-2.5 pr-3">{u.meetingsTotal}</td>
                          <td className="py-2.5 pr-3 text-muted">
                            {new Date(u.createdAt).toLocaleDateString()}
                          </td>
                          <td className="py-2.5">
                            <button onClick={() => setSelectedId(u.id)} className="btn btn-secondary btn-sm">
                              View
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>
      </div>

      {selectedId && (
        <UserDetailPanel
          userId={selectedId}
          onClose={() => setSelectedId(null)}
          onSaved={() => load(query)}
        />
      )}
    </>
  )
}

interface StatCardProps {
  label: string
  value?: number
  hint?: string | false | null
  alert?: boolean
}

function StatCard({ label, value, hint, alert }: StatCardProps) {
  return (
    <div className={'card p-4 ' + (alert ? 'border-danger' : '')}>
      <div className="text-[10px] font-bold text-muted uppercase tracking-widest">{label}</div>
      {value !== undefined && (
        <div className={'text-2xl font-extrabold mt-1 ' + (alert ? 'text-danger' : '')}>{value}</div>
      )}
      {hint && <div className="text-[11px] text-muted mt-1">{hint}</div>}
    </div>
  )
}
