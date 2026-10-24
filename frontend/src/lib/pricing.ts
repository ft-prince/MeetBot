/**
 * Pricing shown to users. The amounts MUST match backend/src/services/planService.ts
 * (PRICES, in paise) — the backend is what actually charges. GST is added at
 * checkout (BILLING_GST_PERCENT on the backend, 18% by default).
 */
import type { PlanId } from './types'

export type Region = 'in' | 'intl'
export type Cycle = 'monthly' | 'annual'

/** Pro, per user per month, in rupees, before GST. */
export const PRO_MONTHLY_RUPEES: Record<Region, Record<Cycle, number>> = {
  in:   { monthly: 360, annual: 300 },
  intl: { monthly: 468, annual: 390 },
}

export const FREE_MINUTES = 120
export const ANNUAL_SAVING_LABEL = 'Save 17%'

export const REGION_LABEL: Record<Region, string> = { in: 'India', intl: 'Outside India' }

export const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`

/** Pro price line, e.g. "Billed ₹3,600 per user yearly, plus GST". */
export function proBilledLine(region: Region, cycle: Cycle): string {
  const perMonth = PRO_MONTHLY_RUPEES[region][cycle]
  return cycle === 'annual'
    ? `Billed ${rupees(perMonth * 12)} per user yearly, plus GST`
    : `Billed ${rupees(perMonth)} per user monthly, plus GST`
}

export interface PricingPlan {
  id: PlanId
  name: string
  blurb: string
  featuresIntro: string
  features: string[]
  popular?: boolean
}

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: 'free',
    name: 'Free',
    blurb: 'Try Renata AI on your own meetings.',
    featuresIntro: 'Includes',
    features: [
      `${FREE_MINUTES} minutes of meetings a month`,
      'Hindi, English and Hinglish transcripts',
      'AI summaries in Hindi or English',
      'Action items by email',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    blurb: 'For professionals and teams who meet every day.',
    featuresIntro: 'Everything in Free, plus',
    features: [
      'Unlimited meetings (fair use)',
      'Action items on WhatsApp, with owners',
      'Searchable meeting history',
      'Export to PDF and Word',
      'No AI credits or usage top-ups',
    ],
    popular: true,
  },
  {
    id: 'business',
    name: 'Enterprise',
    blurb: 'For organisations with security and compliance needs.',
    featuresIntro: 'Everything in Pro, plus',
    features: [
      'Data hosted in India',
      'DPDP consent and deletion logs',
      'Single sign-on and admin controls',
      'Data processing agreement',
      'Dedicated onboarding and support',
    ],
  },
]

export const PRICING_HIGHLIGHTS = [
  { title: 'Built for how India speaks', text: 'Switch between Hindi and English mid-sentence. Your notes keep up.' },
  { title: 'Tasks where your team works', text: 'Owners get their action items on WhatsApp and email after every meeting.' },
  { title: 'Simple INR billing', text: 'Pay by UPI or card, with GST invoices for your business.' },
]

export const PRICING_FAQS = [
  {
    q: 'Which languages are supported?',
    a: 'Hindi, English and Hinglish — including switching between Hindi and English mid-sentence. Summaries can be written in Hindi or English.',
  },
  {
    q: 'Do prices include GST?',
    a: 'No. All prices are in Indian rupees and exclude GST. 18% GST is added at checkout.',
  },
  {
    q: 'Why is pricing different outside India?',
    a: 'Prices are set for each market. Customers outside India pay the "Outside India" price, still billed in Indian rupees.',
  },
  {
    q: `What happens when I use my ${FREE_MINUTES} free minutes?`,
    a: 'The notetaker stops joining new meetings until your minutes reset on the 1st of next month. Everything already recorded stays available. Upgrade to Pro any time for unlimited meetings.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. Auto-renew can be turned off from the Pricing page at any time, and Pro stays active until the end of the period you have paid for.',
  },
  {
    q: 'Who is told that a meeting is being recorded?',
    a: 'The notetaker joins as a visible participant, so everyone in the meeting can see it is there. We recommend telling participants at the start of the call.',
  },
]

export const PRICING_FOOTNOTE = 'All prices in Indian rupees (₹), per user per month, excluding GST.'
