/** "23 Nov 2026" — how plan end dates are shown everywhere. */
export function formatPlanDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Whole days from now until `iso` (0 on the last day, never negative). */
export function daysLeft(iso: string, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000))
}
