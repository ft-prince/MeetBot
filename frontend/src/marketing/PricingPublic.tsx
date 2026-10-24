import { Container, CtaBand, PageHeader, PrimaryCta, PublicShell, SecondaryCta, usePageMeta } from './shell'
import { PricingPlans } from '../components/PricingPlans'
import { FREE_MINUTES, PRO_MONTHLY_RUPEES, rupees } from '../lib/pricing'

export function PricingPublic() {
  usePageMeta(
    'Pricing — Renata AI',
    `Free with ${FREE_MINUTES} meeting minutes a month. Pro from ${rupees(PRO_MONTHLY_RUPEES.in.annual)} per user per month ` +
      'for unlimited meetings in Hindi, English and Hinglish. Enterprise for security and compliance needs.',
  )

  return (
    <PublicShell>
      <PageHeader
        eyebrow="Pricing"
        title="Meeting notes that understand Hindi, English and Hinglish"
        sub="Transcripts, summaries and action items for every meeting, with tasks delivered to WhatsApp and email. Start free, upgrade when your team is ready."
      />

      <section aria-label="Plans" className="border-b border-slate-200">
        <Container className="py-14 sm:py-16">
          <PricingPlans
            renderAction={plan =>
              plan.id === 'business' ? (
                <SecondaryCta to="/contact" label="Talk to sales" />
              ) : (
                <PrimaryCta label={plan.id === 'free' ? 'Start free' : 'Get Pro'} className="w-full" />
              )
            }
          />
        </Container>
      </section>

      <CtaBand
        title="Start free, upgrade when your team is ready"
        sub={`No card to add, no trial countdown — the Free plan includes ${FREE_MINUTES} meeting minutes every month.`}
      />
    </PublicShell>
  )
}
