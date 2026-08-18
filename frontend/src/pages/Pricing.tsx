import { Link } from 'react-router-dom'
import { Topbar } from '../components/Topbar'
import { useAuth } from '../context/AuthContext'
import { UsageCard } from '../components/UsageCard'
import type { PlanId } from '../lib/types'

// ponytail: no billing provider yet — plans are real and enforced server-side
// (backend/src/services/planService.ts), but upgrades are handled by support,
// who set the plan from the Admin page. Swap the "Upgrade" links for a checkout
// URL when payments go live; nothing else here changes.
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
  const { user } = useAuth()
  const usage = user?.usage

  return (
    <>
      <Topbar title="Pricing" subtitle="Choose the plan that fits how you meet" />
      <div className="p-4 sm:p-8 flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto flex flex-col gap-6">

          <UsageCard />

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
                {usage?.plan === p.id ? (
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
