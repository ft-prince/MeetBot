import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Topbar } from '../components/Topbar'
import { useAuth } from '../context/AuthContext'
import { UsageCard } from '../components/UsageCard'
import type { PlanId } from '../lib/types'

// Pro is bought via Razorpay Checkout (backend/src/routes/billing.ts); Business
// still goes through support, who set the plan from the Admin page.
const ONLINE_PLANS: PlanId[] = ['pro']

declare global {
  interface Window { Razorpay?: new (opts: Record<string, unknown>) => { open: () => void } }
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

interface BillingStatus {
  subscribed: boolean
  subscriptionsEnabled: boolean
}

interface Plan {
  id: PlanId
  name: string
  price: string
  cadence: string
  blurb: string
  features: string[]
  highlight?: boolean
  cta: string
}

const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Basic',
    price: '$0',
    cadence: 'per user / month',
    blurb: 'For trying MeetMaster on your own calls.',
    features: [
      '5 recorded meetings per month',
      'Live transcript with speaker labels',
      'AI summary + action items',
      'PDF report by email',
      'Email sync window: up to 10 days',
      'Google Meet support',
    ],
    cta: 'Upgrade',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$18',
    cadence: 'per user / month',
    blurb: 'For people who live in back-to-back meetings.',
    features: [
      'Everything in Basic',
      '100 recorded meetings per month',
      'Calendar auto-join',
      'Email sync window: up to 30 days',
      'Pre-meeting email context per event',
      'Zoom and Microsoft Teams support',
      'Priority transcription queue',
    ],
    highlight: true,
    cta: 'Upgrade to Pro',
  },
  {
    id: 'business',
    name: 'Business',
    price: 'Custom',
    cadence: 'billed annually',
    blurb: 'For teams that need shared meeting memory.',
    features: [
      'Everything in Pro',
      'Unlimited recorded meetings',
      'Shared workspace and search',
      'Self-hosted transcription option',
      'SSO and audit logging',
      'Custom retention policy',
      'Dedicated support channel',
    ],
    cta: 'Talk to us',
  },
]

export function Pricing() {
  const { user, refresh } = useAuth()
  const usage = user?.usage
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [billing, setBilling] = useState<BillingStatus | null>(null)

  const loadStatus = useCallback(() => {
    fetch('/api/billing/status', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(setBilling)
      .catch(() => setBilling(null))
  }, [])
  useEffect(loadStatus, [loadStatus])

  /** Open Razorpay Checkout for either a one-time order or a subscription. */
  async function checkout(plan: PlanId, mode: 'once' | 'subscribe') {
    setBusy(true)
    setError('')
    try {
      await loadCheckout()
      const start = await postJson(mode === 'once' ? '/api/billing/order' : '/api/billing/subscription', { plan })
      new window.Razorpay!({
        key: start.keyId,
        ...(mode === 'once'
          ? { order_id: start.orderId, amount: start.amount, currency: start.currency }
          : { subscription_id: start.subscriptionId }),
        name: 'MeetMaster',
        description: mode === 'once' ? `${plan} plan — 1 month` : `${plan} plan — renews monthly`,
        prefill: { email: user?.email, name: user?.name },
        handler: async (payment: Record<string, string>) => {
          try {
            await postJson('/api/billing/verify', payment)
            await refresh()
            loadStatus()
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
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function renderOnlineActions(p: Plan) {
    const isCurrent = usage?.plan === p.id
    const primary = 'btn w-full justify-center ' + (p.highlight ? 'btn-primary' : 'btn-secondary')
    return (
      <div className="flex flex-col gap-2">
        {billing?.subscribed && isCurrent ? (
          <>
            <button disabled className="btn btn-secondary w-full justify-center">Current plan · auto-renewing</button>
            <button onClick={cancelSubscription} disabled={busy} className="btn btn-secondary btn-sm w-full justify-center">
              Cancel auto-renew
            </button>
          </>
        ) : (
          <>
            {billing?.subscriptionsEnabled && (
              <button onClick={() => checkout(p.id, 'subscribe')} disabled={busy} className={primary}>
                {busy ? 'Opening checkout…' : isCurrent ? 'Turn on auto-renew' : `${p.cta} · monthly`}
              </button>
            )}
            <button onClick={() => checkout(p.id, 'once')} disabled={busy} className="btn btn-secondary w-full justify-center">
              {busy ? 'Opening checkout…' : isCurrent ? 'Add 1 more month' : 'Pay for 1 month'}
            </button>
          </>
        )}
      </div>
    )
  }

  return (
    <>
      <Topbar title="Pricing" subtitle="Choose the plan that fits how you meet" />
      <div className="p-4 sm:p-8 flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto flex flex-col gap-6">

          <UsageCard />
          {error && <div className="card p-3 text-xs text-danger border-danger">{error}</div>}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {PLANS.map(p => (
              <div
                key={p.name}
                className={'card p-5 flex flex-col ' + (p.highlight ? 'border-accent ring-1 ring-accent/20' : '')}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="text-sm font-bold">{p.name}</div>
                  {p.highlight && (
                    <span className="pill bg-accent-light text-accent">Popular</span>
                  )}
                </div>
                <p className="text-xs text-muted mb-4 leading-relaxed">{p.blurb}</p>
                <div className="mb-4">
                  <span className="text-3xl font-extrabold">{p.price}</span>
                  <span className="text-[11px] text-muted ml-1.5">{p.cadence}</span>
                </div>
                <ul className="flex flex-col gap-2 mb-5 flex-1">
                  {p.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-xs text-ink">
                      <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"
                           className="text-success flex-shrink-0 mt-0.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
                {ONLINE_PLANS.includes(p.id) ? (
                  renderOnlineActions(p)
                ) : usage?.plan === p.id ? (
                  <button disabled className="btn btn-secondary w-full justify-center">Current plan</button>
                ) : (
                  <Link
                    to={`/help?issue=upgrade-request&plan=${p.id}`}
                    className={'btn w-full justify-center ' + (p.highlight ? 'btn-primary' : 'btn-secondary')}
                  >
                    {p.cta}
                  </Link>
                )}
              </div>
            ))}
          </div>

          <div className="card p-5">
            <div className="text-sm font-bold mb-2">Email sync limits</div>
            <p className="text-xs text-muted leading-relaxed">
              Email Intelligence fetches and analyzes a bounded window — currently 10, 15, or 30 days,
              selectable from the Email Inbox. This keeps sync fast and avoids sending an entire mailbox
              to the AI. Threads older than the window stay synced and searchable, but are not analyzed
              unless you ask for a full re-analysis.
            </p>
          </div>

          <div className="card p-5 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-sm font-semibold">Questions about a plan?</div>
              <p className="text-xs text-muted">We will help you pick the right one — no sales call required.</p>
            </div>
            <Link to="/help" className="btn btn-secondary btn-sm">Contact Support</Link>
          </div>

        </div>
      </div>
    </>
  )
}
