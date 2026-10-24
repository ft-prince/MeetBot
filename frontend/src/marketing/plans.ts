/**
 * Landing-page plan table. Prices and features come from src/lib/pricing.ts,
 * the single source shared with both pricing pages (backend charges the same
 * amounts — see backend/src/services/planService.ts).
 */
import { FREE_MINUTES, PRICING_PLANS, PRO_MONTHLY_RUPEES, rupees } from '../lib/pricing'

export interface PublicPlan {
  id: 'free' | 'pro' | 'business'
  name: string
  price: string
  cadence: string
}

const PRICE: Record<PublicPlan['id'], { price: string; cadence: string }> = {
  free: { price: '₹0', cadence: 'per month · no card required' },
  pro: { price: rupees(PRO_MONTHLY_RUPEES.in.annual), cadence: 'per user / month, billed yearly · India' },
  business: { price: 'Custom', cadence: 'volume pricing and pilots' },
}

export const PUBLIC_PLANS: PublicPlan[] = PRICING_PLANS.map(p => ({ id: p.id, name: p.name, ...PRICE[p.id] }))

/** Compact comparison rows for the landing page table. */
export const PLAN_MATRIX: { label: string; values: [string, string, string] }[] = [
  { label: 'Meetings', values: [`${FREE_MINUTES} min / month`, 'Unlimited (fair use)', 'Unlimited'] },
  { label: 'Hindi, English & Hinglish transcripts', values: ['Yes', 'Yes', 'Yes'] },
  { label: 'AI summaries in Hindi or English', values: ['Yes', 'Yes', 'Yes'] },
  { label: 'Action items by email', values: ['Yes', 'Yes', 'Yes'] },
  { label: 'Action items on WhatsApp', values: ['—', 'Yes', 'Yes'] },
  { label: 'Export to PDF and Word', values: ['—', 'Yes', 'Yes'] },
  { label: 'Single sign-on & admin controls', values: ['—', '—', 'Yes'] },
  { label: 'Data hosted in India', values: ['—', '—', 'Yes'] },
]
