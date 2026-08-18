import { db } from '../db/client';

/**
 * Subscription plans.
 *
 * Limits live here as a constant map rather than a `plans` table: they change
 * with a deploy, not at runtime, and a table would need an admin UI to edit.
 * Usage is COUNTED from the source tables (meetings) instead of being tracked in
 * a counter column, so it can never drift out of sync with reality.
 *
 * ponytail: no payment provider wired yet — `plan` is set by an admin (see
 * routes/admin.ts). Add a billing webhook that writes the same two columns when
 * you turn on payments; nothing else has to change.
 */
export type PlanId = 'free' | 'pro' | 'business';

export interface Plan {
  id: PlanId;
  name: string;
  /** Meetings the bot may join per calendar month. null = unlimited. */
  meetingsPerMonth: number | null;
  /** Largest email sync window (days) this plan may request. */
  emailSyncDays: number;
}

export const PLANS: Record<PlanId, Plan> = {
  free:     { id: 'free',     name: 'Free',     meetingsPerMonth: 5,    emailSyncDays: 10 },
  pro:      { id: 'pro',      name: 'Pro',      meetingsPerMonth: 100,  emailSyncDays: 30 },
  business: { id: 'business', name: 'Business', meetingsPerMonth: null, emailSyncDays: 30 },
};

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

export async function meetingsThisPeriod(userId: string): Promise<number> {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM meetings
     WHERE user_id = $1 AND started_at >= date_trunc('month', now())`,
    [userId],
  );
  return rows[0]?.n ?? 0;
}

export interface Usage {
  plan: PlanId;
  planName: string;
  meetingsUsed: number;
  meetingsLimit: number | null;
  emailSyncDays: number;
  resetsAt: string;
}

export async function getUsage(userId: string): Promise<Usage> {
  const [plan, meetingsUsed] = await Promise.all([getPlan(userId), meetingsThisPeriod(userId)]);
  return {
    plan: plan.id,
    planName: plan.name,
    meetingsUsed,
    meetingsLimit: plan.meetingsPerMonth,
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

export function isOverMeetingQuota(plan: Plan, used: number): boolean {
  return plan.meetingsPerMonth !== null && used >= plan.meetingsPerMonth;
}

/** Throws QuotaError if this user may not start another meeting this month. */
export async function assertMeetingQuota(userId: string): Promise<void> {
  const plan = await getPlan(userId);
  if (plan.meetingsPerMonth === null) return;
  const used = await meetingsThisPeriod(userId);
  if (!isOverMeetingQuota(plan, used)) return;
  throw new QuotaError(
    `Your ${plan.name} plan allows ${plan.meetingsPerMonth} meetings per month and you've used ${used}. Upgrade to record more.`,
    plan.id,
    plan.meetingsPerMonth,
  );
}

/** Clamp a requested email sync window to what the user's plan allows. */
export function capSyncDays(requested: number, plan: Plan): number {
  return Math.min(requested, plan.emailSyncDays);
}
