import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { db } from '../db/client';
import { config } from '../config';
import { PlanId } from '../services/planService';

/**
 * Razorpay billing. Two ways to pay for Pro:
 *
 *   One-time (30 days, no auto-renew)
 *     POST /api/billing/order         { plan }  → Razorpay order
 *     POST /api/billing/verify        { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 *
 *   Subscription (auto-renews monthly, needs RAZORPAY_PRO_PLAN_ID from the dashboard)
 *     POST /api/billing/subscription  { plan }  → Razorpay subscription
 *     POST /api/billing/verify        { razorpay_subscription_id, razorpay_payment_id, razorpay_signature }
 *     POST /api/billing/cancel        → stops renewal at the end of the paid cycle
 *
 *   POST /api/billing/webhook — Razorpay → us. Applies payments even if the
 *   browser closed before /verify, and every later subscription renewal.
 *
 * Every path ends in applyPayment(), which is idempotent on the payment id, so
 * /verify and the webhook racing each other can't extend the plan twice.
 */
const router = Router();
const RAZORPAY_API = 'https://api.razorpay.com/v1';
const PLAN_DAYS = 30;
const CURRENCY = 'INR';
const SUBSCRIPTION_CYCLES = 120; // Razorpay requires a cap; 10 years of months.

/** Plans a user can buy themselves. Business stays "talk to us". */
function priceFor(plan: unknown): number | null {
  return plan === 'pro' ? config.razorpay.proAmountPaise : null;
}

function hmacHex(data: string | Buffer, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

function safeEqual(expected: string, actual: unknown): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(String(actual));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Checkout signature for an order: HMAC_SHA256(order_id|payment_id). */
export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string, secret: string): boolean {
  return safeEqual(hmacHex(`${orderId}|${paymentId}`, secret), signature);
}

/** Checkout signature for a subscription: HMAC_SHA256(payment_id|subscription_id) — note the order flips. */
export function verifySubscriptionSignature(subscriptionId: string, paymentId: string, signature: string, secret: string): boolean {
  return safeEqual(hmacHex(`${paymentId}|${subscriptionId}`, secret), signature);
}

/** Webhook signature: HMAC_SHA256(raw request body, webhook secret). */
export function verifyWebhookSignature(rawBody: Buffer, signature: unknown, secret: string): boolean {
  return safeEqual(hmacHex(rawBody, secret), signature);
}

async function razorpay(path: string, init?: { method: string; body?: unknown }): Promise<any> {
  const auth = Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64');
  const res = await fetch(`${RAZORPAY_API}${path}`, {
    method: init?.method ?? 'GET',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Razorpay ${path} ${res.status}: ${json?.error?.description ?? 'unknown error'}`);
  return json;
}

interface PaymentRecord {
  userId: string;
  plan: PlanId;
  sourceId: string; // order_… or sub_…
  paymentId: string;
  amount: number;
  currency: string;
}

/** Record the payment and extend the plan. Idempotent on paymentId. */
async function applyPayment(p: PaymentRecord): Promise<{ plan: string; plan_until: Date | null }> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO payments (id, order_id, user_id, plan, amount, currency)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      [p.paymentId, p.sourceId, p.userId, p.plan, p.amount, p.currency],
    );
    // Renewing the same plan stacks on top of the remaining time; anything else starts now.
    const { rows } = ins.rowCount === 0
      ? await client.query('SELECT plan, plan_until FROM users WHERE id = $1', [p.userId])
      : await client.query(
        `UPDATE users SET plan = $1,
           plan_until = CASE WHEN plan = $1 AND plan_until IS NULL THEN NULL  -- admin-granted, no expiry: keep it
                        ELSE GREATEST(now(), CASE WHEN plan = $1 THEN plan_until ELSE now() END)
                             + make_interval(days => $2) END,
           updated_at = now()
         WHERE id = $3 RETURNING plan, plan_until`,
        [p.plan, PLAN_DAYS, p.userId],
      );
    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Notes we attached when creating the order/subscription; the only trusted source of user + plan. */
function trustedNotes(entity: any): { userId: string; plan: PlanId } | null {
  const userId = entity?.notes?.userId;
  const plan = entity?.notes?.plan;
  if (typeof userId !== 'string' || priceFor(plan) === null) return null;
  return { userId, plan };
}

// ── Webhook (no session; authenticated by signature) ─────────────────────────
router.post('/webhook', async (req: Request, res: Response) => {
  const secret = config.razorpay.webhookSecret;
  if (!secret || !config.razorpay.keyId) {
    res.status(503).json({ error: 'Webhook not configured' });
    return;
  }
  if (!req.rawBody || !verifyWebhookSignature(req.rawBody, req.get('x-razorpay-signature'), secret)) {
    res.status(400).json({ error: 'Bad signature' });
    return;
  }
  const event: string = req.body?.event;
  const payment = req.body?.payload?.payment?.entity;
  const subscription = req.body?.payload?.subscription?.entity;
  try {
    if (event === 'payment.captured' && payment?.order_id && !payment?.subscription_id) {
      // One-time: the payment entity doesn't carry our order notes, so fetch the order.
      const notes = trustedNotes(await razorpay(`/orders/${encodeURIComponent(payment.order_id)}`));
      if (notes) {
        await applyPayment({ ...notes, sourceId: payment.order_id, paymentId: payment.id, amount: payment.amount, currency: payment.currency });
      }
    } else if (event === 'subscription.charged' && subscription && payment) {
      const notes = trustedNotes(subscription);
      if (notes) {
        await applyPayment({ ...notes, sourceId: subscription.id, paymentId: payment.id, amount: payment.amount, currency: payment.currency });
      }
    } else if (['subscription.cancelled', 'subscription.completed', 'subscription.halted'].includes(event) && subscription) {
      // Paid time already granted stays; the plan just won't renew.
      await db.query('UPDATE users SET razorpay_subscription_id = NULL WHERE razorpay_subscription_id = $1', [subscription.id]);
    }
    res.json({ ok: true });
  } catch (err) {
    // 5xx makes Razorpay retry, which is what we want for a transient failure.
    console.error(`[billing] webhook ${event} error:`, err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// ── Everything below needs a signed-in user ──────────────────────────────────
router.use((req: Request, res: Response, next) => {
  if (!req.session.userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  if (!config.razorpay.keyId || !config.razorpay.keySecret) {
    res.status(503).json({ error: 'Payments are not configured' });
    return;
  }
  next();
});

// GET /api/billing/status — whether the user has an auto-renewing subscription
router.get('/status', async (req: Request, res: Response) => {
  try {
    const { rows } = await db.query('SELECT razorpay_subscription_id FROM users WHERE id = $1', [req.session.userId]);
    res.json({ subscribed: !!rows[0]?.razorpay_subscription_id, subscriptionsEnabled: !!config.razorpay.proPlanId });
  } catch (err) {
    console.error('[billing] status error:', err);
    res.status(500).json({ error: 'Could not load billing status' });
  }
});

// POST /api/billing/order — one-time checkout for `plan`
router.post('/order', async (req: Request, res: Response) => {
  const plan = req.body?.plan;
  const amount = priceFor(plan);
  if (amount === null) {
    res.status(400).json({ error: 'This plan cannot be purchased online' });
    return;
  }
  try {
    const order = await razorpay('/orders', {
      method: 'POST',
      body: {
        amount,
        currency: CURRENCY,
        receipt: `u_${req.session.userId!.slice(0, 8)}_${Date.now()}`,
        notes: { userId: req.session.userId, plan },
      },
    });
    res.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: config.razorpay.keyId, plan });
  } catch (err) {
    console.error('[billing] create order error:', err);
    res.status(502).json({ error: 'Could not start payment. Please try again.' });
  }
});

// POST /api/billing/subscription — auto-renewing checkout for `plan`
router.post('/subscription', async (req: Request, res: Response) => {
  const plan = req.body?.plan;
  if (priceFor(plan) === null) {
    res.status(400).json({ error: 'This plan cannot be purchased online' });
    return;
  }
  if (!config.razorpay.proPlanId) {
    res.status(503).json({ error: 'Subscriptions are not configured' });
    return;
  }
  try {
    const sub = await razorpay('/subscriptions', {
      method: 'POST',
      body: {
        plan_id: config.razorpay.proPlanId,
        total_count: SUBSCRIPTION_CYCLES,
        customer_notify: 1,
        notes: { userId: req.session.userId, plan },
      },
    });
    res.json({ subscriptionId: sub.id, keyId: config.razorpay.keyId, plan });
  } catch (err) {
    console.error('[billing] create subscription error:', err);
    res.status(502).json({ error: 'Could not start subscription. Please try again.' });
  }
});

// POST /api/billing/verify — called by the checkout handler after payment (either flow)
router.post('/verify', async (req: Request, res: Response) => {
  const {
    razorpay_order_id: orderId,
    razorpay_subscription_id: subscriptionId,
    razorpay_payment_id: paymentId,
    razorpay_signature: signature,
  } = req.body ?? {};
  const isSubscription = typeof subscriptionId === 'string';
  const sourceId = isSubscription ? subscriptionId : orderId;
  if (typeof sourceId !== 'string' || typeof paymentId !== 'string' || typeof signature !== 'string') {
    res.status(400).json({ error: 'Missing payment fields' });
    return;
  }
  const secret = config.razorpay.keySecret;
  const signed = isSubscription
    ? verifySubscriptionSignature(sourceId, paymentId, signature, secret)
    : verifyPaymentSignature(sourceId, paymentId, signature, secret);
  if (!signed) {
    res.status(400).json({ error: 'Payment signature mismatch' });
    return;
  }
  try {
    const path = isSubscription ? `/subscriptions/${encodeURIComponent(sourceId)}` : `/orders/${encodeURIComponent(sourceId)}`;
    const entity = await razorpay(path);
    const notes = trustedNotes(entity);
    const userId = req.session.userId!;
    if (!notes || notes.userId !== userId) {
      res.status(403).json({ error: 'This payment does not belong to your account' });
      return;
    }
    // Subscriptions don't carry an amount on the entity; the payment does.
    const payment = isSubscription ? await razorpay(`/payments/${encodeURIComponent(paymentId)}`) : entity;
    const row = await applyPayment({ ...notes, sourceId, paymentId, amount: payment.amount, currency: payment.currency });
    if (isSubscription) {
      await db.query('UPDATE users SET razorpay_subscription_id = $1 WHERE id = $2', [sourceId, userId]);
    }
    res.json({ ok: true, plan: row.plan, planUntil: row.plan_until, subscribed: isSubscription });
  } catch (err) {
    console.error('[billing] verify error:', err);
    res.status(502).json({ error: 'Payment received but we could not apply it. Contact support.' });
  }
});

// POST /api/billing/cancel — stop auto-renew; paid time is kept
router.post('/cancel', async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  try {
    const { rows } = await db.query('SELECT razorpay_subscription_id FROM users WHERE id = $1', [userId]);
    const subId: string | null = rows[0]?.razorpay_subscription_id ?? null;
    if (!subId) {
      res.status(400).json({ error: 'No active subscription' });
      return;
    }
    await razorpay(`/subscriptions/${encodeURIComponent(subId)}/cancel`, { method: 'POST', body: { cancel_at_cycle_end: 1 } });
    await db.query('UPDATE users SET razorpay_subscription_id = NULL WHERE id = $1', [userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[billing] cancel error:', err);
    res.status(502).json({ error: 'Could not cancel the subscription. Please try again.' });
  }
});

export default router;
