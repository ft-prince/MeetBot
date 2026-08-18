/**
 * Public plan copy. Numbers MUST match backend/src/services/planService.ts
 * (free: 5 meetings/month + 10-day email sync, pro: 100 + 30-day,
 * business: unlimited + 30-day) — those limits are enforced server-side.
 * Names and prices match the authenticated src/pages/Pricing.tsx.
 */
export interface PublicPlan {
  id: 'free' | 'pro' | 'business'
  name: string
  price: string
  cadence: string
  blurb: string
  features: string[]
  highlight?: boolean
}

export const PUBLIC_PLANS: PublicPlan[] = [
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
  },
]

/** Compact comparison rows for the landing page table. */
export const PLAN_MATRIX: { label: string; values: [string, string, string] }[] = [
  { label: 'Recorded meetings / month', values: ['5', '100', 'Unlimited'] },
  { label: 'Email sync window', values: ['10 days', '30 days', '30 days'] },
  { label: 'Google Meet', values: ['Yes', 'Yes', 'Yes'] },
  { label: 'Zoom & Microsoft Teams', values: ['—', 'Yes', 'Yes'] },
  { label: 'Calendar auto-join', values: ['—', 'Yes', 'Yes'] },
  { label: 'SSO & audit logging', values: ['—', '—', 'Yes'] },
]
