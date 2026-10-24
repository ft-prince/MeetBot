import { useState, type ReactNode } from 'react'
import { Faq } from '../marketing/shell'
import type { PlanId } from '../lib/types'
import {
  ANNUAL_SAVING_LABEL, PRICING_FAQS, PRICING_FOOTNOTE, PRICING_HIGHLIGHTS, PRICING_PLANS,
  PRO_MONTHLY_RUPEES, REGION_LABEL, proBilledLine, rupees,
  type Cycle, type PricingPlan, type Region,
} from '../lib/pricing'

export interface PricingSelection { region: Region; cycle: Cycle }

interface Props {
  /** The button(s) under each plan's price. */
  renderAction: (plan: PricingPlan, sel: PricingSelection) => ReactNode
  /** Plan the signed-in user is on; that card gets a "Current plan" mark. */
  currentPlanId?: PlanId
  /** Extra line under the current plan's badge, e.g. "Valid until 23 Nov 2026". */
  currentPlanNote?: string
}

/**
 * Pricing cards shared by the in-app Pricing page and the public site, so the
 * two can never show different prices or features.
 */
export function PricingPlans({ renderAction, currentPlanId, currentPlanNote }: Props) {
  const [cycle, setCycle] = useState<Cycle>('annual')
  const [region, setRegion] = useState<Region>('in')
  const sel = { region, cycle }

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Segmented
          label="Billing cycle"
          value={cycle}
          onChange={setCycle}
          options={[
            { value: 'annual', label: <>Annual <span className="ml-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-success">{ANNUAL_SAVING_LABEL}</span></> },
            { value: 'monthly', label: 'Monthly' },
          ]}
        />
        <Segmented
          label="Region"
          value={region}
          onChange={setRegion}
          options={[
            { value: 'in', label: REGION_LABEL.in },
            { value: 'intl', label: REGION_LABEL.intl },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {PRICING_PLANS.map(plan => {
          const isCurrent = plan.id === currentPlanId
          return (
            <div
              key={plan.id}
              className={'card relative flex flex-col p-6 ' +
                (isCurrent ? 'border-success ring-2 ring-success/25' : plan.popular ? 'border-accent ring-1 ring-accent/20' : '')}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <h3 className="text-base font-bold text-ink">{plan.name}</h3>
                {isCurrent ? (
                  <span className="pill bg-emerald-100 text-success">✓ Current plan</span>
                ) : plan.popular ? (
                  <span className="pill bg-accent-light text-accent">Most popular</span>
                ) : null}
              </div>
              {isCurrent && currentPlanNote && <p className="mb-1 text-xs font-medium text-success">{currentPlanNote}</p>}
              <p className="mb-5 text-sm text-muted">{plan.blurb}</p>

              <PriceBlock plan={plan} sel={sel} />

              <div className="mt-5">{renderAction(plan, sel)}</div>

              <div className="mt-6 border-t border-gray-200 pt-5">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{plan.featuresIntro}</p>
                <ul className="flex flex-col gap-2.5">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm text-ink">
                      <CheckIcon />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {PRICING_HIGHLIGHTS.map(h => (
          <div key={h.title}>
            <h3 className="mb-1 text-sm font-semibold text-ink">{h.title}</h3>
            <p className="text-sm leading-relaxed text-muted">{h.text}</p>
          </div>
        ))}
      </div>

      <div>
        <h2 className="mb-3 text-lg font-bold text-ink">Frequently asked questions</h2>
        <Faq items={PRICING_FAQS} />
        <p className="mt-6 text-xs text-muted">{PRICING_FOOTNOTE}</p>
      </div>
    </div>
  )
}

function PriceBlock({ plan, sel }: { plan: PricingPlan; sel: PricingSelection }) {
  if (plan.id === 'free') {
    return <Price amount="₹0" unit="/ month" note="No card required" />
  }
  if (plan.id === 'pro') {
    return (
      <Price
        amount={rupees(PRO_MONTHLY_RUPEES[sel.region][sel.cycle])}
        unit="/ user / month"
        note={proBilledLine(sel.region, sel.cycle)}
      />
    )
  }
  return <Price amount="Custom" note="Volume pricing and pilots available" />
}

function Price({ amount, unit, note }: { amount: string; unit?: string; note: string }) {
  return (
    <div>
      <span className="text-3xl font-extrabold tabular-nums text-ink">{amount}</span>
      {unit && <span className="ml-1.5 text-xs text-muted">{unit}</span>}
      <p className="mt-1 text-xs text-muted">{note}</p>
    </div>
  )
}

function Segmented<T extends string>({ label, value, onChange, options }: {
  label: string
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode }[]
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={'rounded-md px-3 py-1.5 text-sm font-medium transition-colors ' +
            (value === o.value ? 'bg-accent text-white' : 'text-ink hover:bg-gray-100')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function CheckIcon() {
  return (
    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"
         className="mt-0.5 flex-shrink-0 text-success" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
