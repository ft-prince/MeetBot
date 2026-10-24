import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Topbar } from '../components/Topbar'
import { UsageCard } from '../components/UsageCard'
import { PricingPlans, type PricingSelection } from '../components/PricingPlans'
import { useAuth } from '../context/AuthContext'
import { formatPlanDate } from '../lib/planDisplay'
import type { PricingPlan } from '../lib/pricing'

// Pro is bought via Razorpay Checkout (backend/src/routes/billing.ts);
// Enterprise goes through sales.

declare global {
  interface Window { Razorpay?: new (opts: Record<string, unknown>) => { open: () => void } }
}

interface BillingStatus {
  subscribed: boolean
  gstPercent: number
  subscriptionsEnabled: Record<'in' | 'intl', Record<'monthly' | 'annual', boolean>>
}

function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Could not load Razorpay'))
    document.body.appendChild(s)
  })
}

async function postJson(url: string, body: unknown) {
  const r = await fetch(url, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`)
  return j
}

export function Pricing() {
  const { user, refresh } = useAuth()
  const usage = user?.usage
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [billing, setBilling] = useState<BillingStatus | null>(null)

  const loadStatus = useCallback(() => {
    fetch('/api/billing/status', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(setBilling)
      .catch(() => setBilling(null))
  }, [])
  useEffect(loadStatus, [loadStatus])

  /** Open Razorpay Checkout for a one-time order or a subscription. */
  async function checkout(sel: PricingSelection, mode: 'once' | 'subscribe') {
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      await loadCheckout()
      const body = { plan: 'pro', ...sel }
      const start = await postJson(mode === 'once' ? '/api/billing/order' : '/api/billing/subscription', body)
      const period = sel.cycle === 'annual' ? 'year' : 'month'
      new window.Razorpay!({
        key: start.keyId,
        ...(mode === 'once'
          ? { order_id: start.orderId, amount: start.amount, currency: start.currency }
          : { subscription_id: start.subscriptionId }),
        name: 'Renata AI',
        description: mode === 'once' ? `Pro — 1 ${period} (incl. GST)` : `Pro — renews every ${period} (incl. GST)`,
        prefill: { email: user?.email, name: user?.name },
        handler: async (payment: Record<string, string>) => {
          try {
            const result = await postJson('/api/billing/verify', payment)
            await refresh()
            loadStatus()
            setSuccess(result.planUntil
              ? `Payment successful — you're on Pro until ${formatPlanDate(result.planUntil)}.`
              : `Payment successful — you're on Pro.`)
          } catch (e) {
            setError((e as Error).message)
          } finally {
            setBusy(false)
          }
        },
        modal: { ondismiss: () => setBusy(false) },
      }).open()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  async function cancelSubscription() {
    if (!window.confirm('Stop auto-renew? You keep Pro until the end of the period you paid for.')) return
    setBusy(true)
    setError('')
    try {
      await postJson('/api/billing/cancel', {})
      loadStatus()
      setSuccess('Auto-renew is off. Pro stays active until the end of your paid period.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function renderAction(plan: PricingPlan, sel: PricingSelection) {
    const isCurrent = usage?.plan === plan.id
    if (plan.id === 'free') {
      return (
        <button disabled className="btn btn-secondary w-full justify-center">
          {isCurrent ? 'Current plan' : 'Included in your plan'}
        </button>
      )
    }
    if (plan.id === 'business') {
      return isCurrent
        ? <button disabled className="btn btn-secondary w-full justify-center">Current plan</button>
        : <Link to="/help?issue=upgrade-request&plan=business" className="btn btn-secondary w-full justify-center">Talk to sales</Link>
    }
    // Pro
    if (billing?.subscribed && isCurrent) {
      return (
        <div className="flex flex-col gap-2">
          <button disabled className="btn btn-secondary w-full justify-center">✓ Auto-renew is on</button>
          <button onClick={cancelSubscription} disabled={busy} className="btn btn-secondary btn-sm w-full justify-center">
            Cancel auto-renew
          </button>
        </div>
      )
    }
    const canSubscribe = billing?.subscriptionsEnabled?.[sel.region]?.[sel.cycle]
    const period = sel.cycle === 'annual' ? 'year' : 'month'
    return (
      <div className="flex flex-col gap-2">
        {canSubscribe && (
          <button onClick={() => checkout(sel, 'subscribe')} disabled={busy} className="btn btn-primary w-full justify-center">
            {busy ? 'Opening checkout…' : isCurrent ? 'Turn on auto-renew' : 'Get Pro'}
          </button>
        )}
        <button
          onClick={() => checkout(sel, 'once')}
          disabled={busy}
          className={'btn w-full justify-center ' + (canSubscribe ? 'btn-secondary' : 'btn-primary')}
        >
          {busy ? 'Opening checkout…' : isCurrent ? `Add 1 more ${period}` : canSubscribe ? `Pay for 1 ${period}` : 'Get Pro'}
        </button>
      </div>
    )
  }

  return (
    <>
      <Topbar title="Pricing" subtitle="Plans and billing" />
      <div className="p-4 sm:p-8 flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto flex flex-col gap-6">
          <UsageCard subscribed={billing?.subscribed} />

          {success && (
            <div role="status" className="card p-3 text-sm font-medium text-success border-success">✓ {success}</div>
          )}
          {error && <div role="alert" className="card p-3 text-sm text-danger border-danger">{error}</div>}

          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-accent">Pricing</p>
            <h1 className="mt-2 text-2xl sm:text-3xl font-bold text-ink">
              Meeting notes that understand Hindi, English and Hinglish
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-muted">
              Transcripts, summaries and action items for every meeting, with tasks delivered to WhatsApp and
              email. Start free, upgrade when your team is ready.
            </p>
          </div>

          <PricingPlans
            renderAction={renderAction}
            currentPlanId={usage?.plan}
            currentPlanNote={usage?.planUntil ? `Valid until ${formatPlanDate(usage.planUntil)}` : undefined}
          />
        </div>
      </div>
    </>
  )
}
