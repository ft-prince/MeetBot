import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { daysLeft, formatPlanDate } from '../lib/planDisplay'

/**
 * The user's plan at a glance: which plan, whether it's paid, until when, and
 * (on Free) how many of this month's meeting minutes are left. Reads the
 * `usage` block /auth/me already returns, so it costs no extra request.
 * `compact` is the dashboard variant: hidden for paid plans and until a free
 * user is close to the limit. `subscribed` (auto-renew on) comes from the
 * Pricing page, which already loads billing status.
 */
export function UsageCard({ compact = false, subscribed }: { compact?: boolean; subscribed?: boolean }) {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const usage = user?.usage
  if (!usage) return null

  const { minutesUsed, minutesLimit, planName, planUntil } = usage
  const isPaid = usage.plan !== 'free'
  const limited = minutesLimit !== null
  const pct = limited ? Math.min(100, Math.round((minutesUsed / minutesLimit) * 100)) : 0
  const exhausted = limited && minutesUsed >= minutesLimit

  if (compact && (!limited || pct < 80)) return null

  const resets = new Date(usage.resetsAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })
  const left = planUntil ? daysLeft(planUntil) : null

  return (
    <div className={'card p-4 flex items-center justify-between gap-4 flex-wrap ' +
      (exhausted ? 'border-danger' : isPaid ? 'border-success' : '')}>
      <div className="min-w-[220px] flex-1">
        <div className="text-sm font-semibold mb-1 flex items-center gap-2 flex-wrap">
          <span>{planName} plan</span>
          {isPaid && <span className="pill bg-emerald-100 text-success">✓ Paid</span>}
          {subscribed && <span className="pill bg-accent-light text-accent">Auto-renew on</span>}
          {exhausted && <span className="pill bg-red-100 text-danger">limit reached</span>}
        </div>
        <p className="text-xs text-muted">
          {isPaid
            ? planUntil
              ? `${subscribed ? 'Renews' : 'Valid until'} ${formatPlanDate(planUntil)} · ${left} day${left === 1 ? '' : 's'} left · unlimited meetings`
              : 'No expiry · unlimited meetings'
            : `${minutesUsed} of ${minutesLimit} free minutes used this month · resets ${resets}`}
        </p>
        {limited && (
          <div className="h-1.5 bg-gray-200 rounded-full mt-2 overflow-hidden">
            <div
              className={'h-full rounded-full ' + (exhausted ? 'bg-danger' : 'bg-accent')}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>
      {!isPaid && pathname !== '/pricing' && (
        <Link to="/pricing" className="btn btn-primary btn-sm">Upgrade</Link>
      )}
      {isPaid && pathname !== '/pricing' && pathname !== '/profile' && (
        <Link to="/profile" className="btn btn-secondary btn-sm">Billing</Link>
      )}
    </div>
  )
}
