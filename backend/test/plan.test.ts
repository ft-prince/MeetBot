import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CYCLE_DAYS, PLANS, PRICES, capSyncDays, chargeAmount, effectivePlan, isOverMinuteQuota, isPlanId,
  periodEnd, periodStart,
} from '../src/services/planService';

// Plan resolution decides whether a paying customer keeps their limits and
// whether a lapsed one is quietly downgraded — no cron job re-writes the column,
// so this function is the only thing standing between "expired" and "unlimited".

test('a known plan id with no expiry stays in force', () => {
  assert.equal(effectivePlan('pro', null).id, 'pro');
  assert.equal(effectivePlan('business', null).minutesPerMonth, null);
});

test('an expired paid plan degrades to free', () => {
  const yesterday = new Date('2026-08-01T00:00:00Z');
  const now = new Date('2026-08-02T00:00:00Z');
  assert.equal(effectivePlan('pro', yesterday, now).id, 'free');
});

test('a paid plan is still in force on its last day', () => {
  const now = new Date('2026-08-02T00:00:00Z');
  const tomorrow = new Date('2026-08-03T00:00:00Z');
  assert.equal(effectivePlan('pro', tomorrow, now).id, 'pro');
});

test('an unknown or missing plan value falls back to free, never to a paid plan', () => {
  assert.equal(effectivePlan('enterprise', null).id, 'free');
  assert.equal(effectivePlan(null, null).id, 'free');
  assert.equal(effectivePlan(undefined, new Date('2099-01-01')).id, 'free');
  assert.equal(isPlanId('enterprise'), false);
});

test('free plan is 120 minutes; quota blocks at the limit, not a minute past it', () => {
  assert.equal(PLANS.free.minutesPerMonth, 120);
  assert.equal(isOverMinuteQuota(PLANS.free, 119), false);
  assert.equal(isOverMinuteQuota(PLANS.free, 120), true);
  assert.equal(isOverMinuteQuota(PLANS.pro, 100_000), false); // unlimited (fair use)
  assert.equal(isOverMinuteQuota(PLANS.business, 100_000), false);
});

// These amounts are what customers are actually charged — they must match the
// pricing page: India ₹360/mo or ₹3,600/yr, outside India ₹468/mo or ₹4,680/yr.
test('Pro list prices match the published pricing (paise, before GST)', () => {
  assert.deepEqual(PRICES, {
    in: { monthly: 36000, annual: 360000 },
    intl: { monthly: 46800, annual: 468000 },
  });
  // Annual is ₹300 / ₹390 a month, i.e. ~17% off monthly.
  assert.equal(PRICES.in.annual / 12, 30000);
  assert.equal(PRICES.intl.annual / 12, 39000);
});

test('charge adds GST and rounds to the rupee; annual buys a year', () => {
  assert.equal(chargeAmount('in', 'monthly', 18), 42500);    // 360 × 1.18 = 424.8 → ₹425
  assert.equal(chargeAmount('in', 'annual', 18), 424800);    // ₹4,248
  assert.equal(chargeAmount('intl', 'monthly', 0), 46800);   // no GST configured
  assert.equal(CYCLE_DAYS.monthly, 30);
  assert.equal(CYCLE_DAYS.annual, 365);
});

test('the sync window is clamped down by the plan but never widened', () => {
  assert.equal(capSyncDays(30, PLANS.free), PLANS.free.emailSyncDays);
  assert.equal(capSyncDays(10, PLANS.pro), 10);
});

test('the usage period is the calendar month', () => {
  const now = new Date(2026, 7, 15, 13, 30); // 15 Aug 2026, local time
  assert.equal(periodStart(now).getTime(), new Date(2026, 7, 1).getTime());
  assert.equal(periodEnd(now).getTime(), new Date(2026, 8, 1).getTime());
});
