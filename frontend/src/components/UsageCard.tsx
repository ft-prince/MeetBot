import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

/**
 * Current plan + this month's meeting usage. Reads the `usage` block that
 * /auth/me already returns, so it costs no extra request. `compact` renders the
 * dashboard variant, which stays hidden until the user is close to the limit.
 */
export function UsageCard({ compact = false }: { compact?: boolean }) {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const usage = user?.usage
  if (!usage) return null

  const { meetingsUsed, meetingsLimit, planName } = usage
  const unlimited = meetingsLimit === null
  const pct = unlimited ? 0 : Math.min(100, Math.round((meetingsUsed / meetingsLimit) * 100))
  const exhausted = !unlimited && meetingsUsed >= meetingsLimit

  // Nothing useful to say on the dashboard until the limit is actually near.
  if (compact && (unlimited || pct < 80)) return null

  const resets = new Date(usage.resetsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

  return (
    <div className={'card p-4 flex items-center justify-between gap-4 flex-wrap ' + (exhausted ? 'border-danger' : '')}>
      <div className="min-w-[220px] flex-1">
        <div className="text-sm font-semibold mb-1">
          {planName} plan
          {exhausted && <span className="pill bg-red-100 text-danger ml-2">limit reached</span>}
        </div>
        <p className="text-xs text-muted">
          {unlimited
            ? `${meetingsUsed} meetings recorded this month · unlimited`
            : `${meetingsUsed} of ${meetingsLimit} meetings used this month · resets ${resets}`}
        </p>
        {!unlimited && (
          <div className="h-1.5 bg-gray-200 rounded-full mt-2 overflow-hidden">
            <div
              className={'h-full rounded-full ' + (exhausted ? 'bg-danger' : 'bg-accent')}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>
      {!unlimited && (
        <Link
          to={pathname === '/pricing' ? '/help?issue=upgrade-request&plan=pro' : '/pricing'}
          className="btn btn-primary btn-sm"
        >
          {pathname === '/pricing' ? 'Request upgrade' : 'Upgrade'}
        </Link>
      )}
    </div>
  )
}
