import { Link } from 'react-router-dom'
import {
  Container,
  CtaBand,
  Eyebrow,
  Faq,
  PageHeader,
  PrimaryCta,
  PublicShell,
  Section,
  SecondaryCta,
  usePageMeta,
} from './shell'
import { Icon } from './icons'
import { UsageMock } from './mocks'
import { FAQS } from './content'
import { PLAN_MATRIX, PUBLIC_PLANS } from './plans'

const pricingFaqs = FAQS.filter(f => f.category === 'Pricing')

const NOTES = [
  {
    q: 'What counts as a recorded meeting',
    a: 'One meeting the bot successfully joined, in the current calendar month. Meetings the bot never got into do not count. The count resets on the 1st.',
  },
  {
    q: 'The email sync window',
    a: 'How far back email intelligence may read your Gmail: up to 10 days on Basic, up to 30 days on Pro and Business. The service will not sync further back than your plan allows.',
  },
]

export function PricingPublic() {
  usePageMeta(
    'Pricing — MeetMaster',
    'Basic is free with 5 recorded meetings a month. Pro is $18 per user with 100 meetings a month, Zoom and Teams, and calendar auto-join. Business is unlimited.',
  )

  return (
    <PublicShell>
      <PageHeader
        eyebrow="Pricing"
        title="Three plans, real limits"
        sub="Every number here is enforced server-side. Start on Basic with your Google account; upgrade when you outgrow it."
        aside={<UsageMock />}
      />

      {/* Plan cards — the recommended one is marked with a rule and a label. */}
      <section aria-label="Plans" className="border-b border-slate-200">
        <Container className="py-14 sm:py-16">
          <div className="grid gap-5 lg:grid-cols-3">
            {PUBLIC_PLANS.map(plan => (
              <div
                key={plan.id}
                data-reveal
                className={`surface relative flex flex-col p-7 ${plan.highlight ? 'border-accent/40 ring-1 ring-accent/15' : ''}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-[15px] font-semibold text-ink">{plan.name}</h2>
                  {plan.highlight && <Eyebrow>Recommended</Eyebrow>}
                </div>
                <p className="display mt-5 text-[38px] leading-none tabular-nums">{plan.price}</p>
                <p className="mt-2 text-[12px] text-slate-500">{plan.cadence}</p>
                <p className="mt-4 text-[14px] leading-relaxed text-slate-600">{plan.blurb}</p>
                <div className="mt-6">
                  {plan.id === 'business' ? (
                    <SecondaryCta to="/contact" label="Talk to us" />
                  ) : (
                    <PrimaryCta label={plan.id === 'free' ? 'Start free' : 'Get Pro'} />
                  )}
                </div>
                <ul className="mt-7 flex flex-col gap-3 border-t border-slate-200 pt-6">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2.5 text-[13px] leading-relaxed text-ink">
                      <Icon name="check" size={15} className="mt-0.5 shrink-0 text-accent" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <Section id="compare" label="Comparison" title="Side by side" tinted>
        <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <caption className="sr-only">Plan comparison</caption>
            <thead>
              <tr className="border-b border-slate-200">
                <th scope="col" className="w-1/3 pb-3 text-left text-[12px] font-medium uppercase tracking-[.1em] text-slate-500">
                  Feature
                </th>
                {PUBLIC_PLANS.map(p => (
                  <th key={p.id} scope="col" className="pb-3 pr-4 text-left text-[15px] font-semibold text-ink">
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PLAN_MATRIX.map(row => (
                <tr key={row.label} className="border-b border-slate-200">
                  <th scope="row" className="py-3.5 pr-4 text-left font-normal text-slate-600">{row.label}</th>
                  {row.values.map((v, i) => (
                    <td key={i} className="py-3.5 pr-4 tabular-nums text-ink">
                      {v === 'Yes' ? (
                        <>
                          <Icon name="check" size={16} className="text-accent" />
                          <span className="sr-only">Included</span>
                        </>
                      ) : v === '—' ? (
                        <>
                          <span aria-hidden="true">—</span>
                          <span className="sr-only">Not included</span>
                        </>
                      ) : (
                        v
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="notes" label="Fine print" title="In plain words">
        <div className="max-w-3xl">
          <dl className="border-t border-slate-200">
            {NOTES.map(n => (
              <div key={n.q} className="border-b border-slate-200 py-5 sm:grid sm:grid-cols-[220px_1fr] sm:gap-10">
                <dt className="mb-2 text-[15px] font-medium text-ink sm:mb-0">{n.q}</dt>
                <dd className="measure text-[15px] leading-relaxed text-slate-600">{n.a}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-10">
            <Faq items={pricingFaqs} />
          </div>
          <p className="mt-8 text-[13px] text-slate-500">
            Anything else on the{' '}
            <Link to="/faq" className="focus-ring rounded font-medium text-accent hover:underline">FAQ page</Link>.
          </p>
        </div>
      </Section>

      <CtaBand
        title="Start on Basic, upgrade when it hurts"
        sub="No card to add, no trial countdown — the free plan simply keeps working at five meetings a month."
      />
    </PublicShell>
  )
}
