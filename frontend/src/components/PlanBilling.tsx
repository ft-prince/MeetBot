import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { formatPlanDate } from '../lib/planDisplay'
import { rupees } from '../lib/pricing'
import { UsageCard } from './UsageCard'

interface Payment {
  id: string
  plan: string
  amount: number // paise
  currency: string
  createdAt: string
  isSubscription: boolean
}

/** Profile → "Plan & billing": current plan plus every payment made. */
export function PlanBilling() {
  const { user } = useAuth()
  const [payments, setPayments] = useState<Payment[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/billing/payments', { credentials: 'include' })
      .then(async r => {
        // 503 = payments not configured on this server: just show no history.
        if (r.status === 503) return { payments: [] }
        if (!r.ok) throw new Error('Could not load payment history')
        return r.json()
      })
      .then(j => setPayments(j.payments))
      .catch(e => setError((e as Error).message))
  }, [])

  if (!user) return null

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-200 bg-app-bg font-bold text-sm flex items-center justify-between">
        Plan &amp; billing
        <Link to="/pricing" className="text-xs font-semibold text-accent hover:underline">
          {user.usage.plan === 'free' ? 'Upgrade' : 'Manage plan'}
        </Link>
      </div>

      <div className="p-5 border-b border-gray-200">
        <UsageCard />
      </div>

      <div className="p-5">
        <div className="text-sm font-semibold mb-3">Payment history</div>
        {error && <p className="text-xs text-danger">{error}</p>}
        {!error && payments === null && <p className="text-xs text-muted">Loading…</p>}
        {payments?.length === 0 && <p className="text-xs text-muted">No payments yet.</p>}
        {payments && payments.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-gray-200">
                <th className="pb-2 font-medium">Date</th>
                <th className="pb-2 font-medium">Plan</th>
                <th className="pb-2 font-medium text-right">Amount</th>
                <th className="pb-2 font-medium text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id} className="border-b border-gray-100 last:border-b-0">
                  <td className="py-2.5">{formatPlanDate(p.createdAt)}</td>
                  <td className="py-2.5 capitalize">
                    {p.plan}
                    <span className="text-xs text-muted">{p.isSubscription ? ' · auto-renew' : ' · one-time'}</span>
                  </td>
                  <td className="py-2.5 text-right tabular-nums">{rupees(p.amount / 100)}</td>
                  <td className="py-2.5 text-right">
                    <span className="pill bg-emerald-100 text-success" title={p.id}>✓ Paid</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
