import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLANS, capSyncDays, effectivePlan, isOverMeetingQuota, isPlanId, periodEnd, periodStart,
} from '../src/services/planService';

// Plan resolution decides whether a paying customer keeps their limits and
// whether a lapsed one is quietly downgraded — no cron job re-writes the column,
// so this function is the only thing standing between "expired" and "unlimited".

test('a known plan id with no expiry stays in force', () => {
  assert.equal(effectivePlan('pro', null).id, 'pro');
  assert.equal(effectivePlan('business', null).meetingsPerMonth, null);
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

test('quota blocks at the limit, not one meeting past it', () => {
  assert.equal(isOverMeetingQuota(PLANS.free, PLANS.free.meetingsPerMonth! - 1), false);
  assert.equal(isOverMeetingQuota(PLANS.free, PLANS.free.meetingsPerMonth!), true);
  assert.equal(isOverMeetingQuota(PLANS.business, 10_000), false); // unlimited
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
