import { db } from '../db/client';

/**
 * Subscription plans.
 *
 * Limits live here as a constant map rather than a `plans` table: they change
 * with a deploy, not at runtime, and a table would need an admin UI to edit.
 * Usage is COUNTED from the source tables (meetings) instead of being tracked in
 * a counter column, so it can never drift out of sync with reality.
 *
 * `plan` / `plan_until` are written by Razorpay payments (routes/billing.ts) or
 * by an admin (routes/admin.ts). Prices live in PRICES below.
 */
export type PlanId = 'free' | 'pro' | 'business';

export interface Plan {
  id: PlanId;
  name: string;
  /** Meeting minutes the bot may record per calendar month. null = unlimited (fair use). */
  minutesPerMonth: number | null;
  /** Largest email sync window (days) this plan may request. */
  emailSyncDays: number;
}

// `business` keeps its id (stored in users.plan) but is sold as "Enterprise".
export const PLANS: Record<PlanId, Plan> = {
  free:     { id: 'free',     name: 'Free',       minutesPerMonth: 120,  emailSyncDays: 10 },
  pro:      { id: 'pro',      name: 'Pro',        minutesPerMonth: null, emailSyncDays: 30 },
  business: { id: 'business', name: 'Enterprise', minutesPerMonth: null, emailSyncDays: 30 },
};

// ── Prices (Pro only; Enterprise is "talk to sales") ─────────────────────────
export type Region = 'in' | 'intl';
export type Cycle = 'monthly' | 'annual';

/** Pro price per user, in paise, EXCLUDING GST, for one billing period. */
export const PRICES: Record<Region, Record<Cycle, number>> = {
  in:   { monthly: 360_00, annual: 3_600_00 }, // ₹360/mo, or ₹300/mo billed ₹3,600/yr
  intl: { monthly: 468_00, annual: 4_680_00 }, // ₹468/mo, or ₹390/mo billed ₹4,680/yr
};

/** Days of Pro one payment buys. */
export const CYCLE_DAYS: Record<Cycle, number> = { monthly: 30, annual: 365 };

export function isRegion(v: unknown): v is Region { return v === 'in' || v === 'intl'; }
export function isCycle(v: unknown): v is Cycle { return v === 'monthly' || v === 'annual'; }

/** Amount to charge in paise: list price plus GST, rounded to the rupee. */
export function chargeAmount(region: Region, cycle: Cycle, gstPercent: number): number {
  const withGst = PRICES[region][cycle] * (1 + gstPercent / 100);
  return Math.round(withGst / 100) * 100;
}

export const DEFAULT_PLAN: PlanId = 'free';

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && value in PLANS;
}

/**
 * Resolve a stored (plan, plan_until) pair to the plan actually in force.
 * An expired paid plan silently degrades to free — no cron job needed.
 */
export function effectivePlan(plan: unknown, planUntil: Date | string | null, now: Date = new Date()): Plan {
  if (!isPlanId(plan) || plan === 'free') return PLANS[DEFAULT_PLAN];
  if (planUntil && new Date(planUntil).getTime() < now.getTime()) return PLANS[DEFAULT_PLAN];
  return PLANS[plan];
}

/** First instant of the current usage period (calendar month, server time). */
export function periodStart(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export function periodEnd(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

export async function getPlan(userId: string): Promise<Plan> {
  const { rows } = await db.query('SELECT plan, plan_until FROM users WHERE id = $1', [userId]);
  if (!rows[0]) return PLANS[DEFAULT_PLAN];
  return effectivePlan(rows[0].plan, rows[0].plan_until);
}

/**
 * Meeting minutes recorded this calendar month. A meeting still in progress
 * (no duration yet) counts up to now, so a live call can't dodge the limit.
 */
export const MINUTES_THIS_MONTH_SQL = `
  COALESCE(sum(COALESCE(duration_ms,
    EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - started_at)) * 1000)), 0) / 60000`;

export async function minutesThisPeriod(userId: string): Promise<number> {
  const { rows } = await db.query(
    `SELECT floor(${MINUTES_THIS_MONTH_SQL})::int AS n FROM meetings
     WHERE user_id = $1 AND started_at >= date_trunc('month', now())`,
    [userId],
  );
  return rows[0]?.n ?? 0;
}

export interface Usage {
  plan: PlanId;
  planName: string;
  /** When the paid plan ends; null = no expiry (or free). */
  planUntil: string | null;
  minutesUsed: number;
  minutesLimit: number | null;
  emailSyncDays: number;
  resetsAt: string;
}

export async function getUsage(userId: string): Promise<Usage> {
  const [{ rows }, minutesUsed] = await Promise.all([
    db.query('SELECT plan, plan_until FROM users WHERE id = $1', [userId]),
    minutesThisPeriod(userId),
  ]);
  const plan = rows[0] ? effectivePlan(rows[0].plan, rows[0].plan_until) : PLANS[DEFAULT_PLAN];
  const planUntil = plan.id !== 'free' && rows[0]?.plan_until ? new Date(rows[0].plan_until).toISOString() : null;
  return {
    plan: plan.id,
    planName: plan.name,
    planUntil,
    minutesUsed,
    minutesLimit: plan.minutesPerMonth,
    emailSyncDays: plan.emailSyncDays,
    resetsAt: periodEnd().toISOString(),
  };
}

/** Thrown when a plan limit blocks an action. Routes map this to HTTP 402. */
export class QuotaError extends Error {
  readonly status = 402;
  constructor(message: string, readonly plan: PlanId, readonly limit: number) {
    super(message);
    this.name = 'QuotaError';
  }
}

export function isOverMinuteQuota(plan: Plan, usedMinutes: number): boolean {
  return plan.minutesPerMonth !== null && usedMinutes >= plan.minutesPerMonth;
}

/**
 * Throws QuotaError if this user has no meeting minutes left this month.
 * ponytail: checked when a meeting starts; a meeting already running is not cut
 * off at the limit. Add a mid-call check in botManager if that gets abused.
 */
export async function assertMeetingQuota(userId: string): Promise<void> {
  const plan = await getPlan(userId);
  if (plan.minutesPerMonth === null) return;
  const used = await minutesThisPeriod(userId);
  if (!isOverMinuteQuota(plan, used)) return;
  throw new QuotaError(
    `You've used all ${plan.minutesPerMonth} free meeting minutes this month. Upgrade to Pro for unlimited meetings.`,
    plan.id,
    plan.minutesPerMonth,
  );
}

/** Clamp a requested email sync window to what the user's plan allows. */
export function capSyncDays(requested: number, plan: Plan): number {
  return Math.min(requested, plan.emailSyncDays);
}
