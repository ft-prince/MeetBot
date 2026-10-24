/**
 * CLI smoke test for Razorpay keys + the backend billing flow.
 *
 *   npx tsx scripts/test-razorpay.ts                 # keys only: create + fetch a test order
 *   NOTEAI_COOKIE='connect.sid=...' npx tsx scripts/test-razorpay.ts   # full flow against the running backend
 *
 * The full flow signs a fake payment id with your key secret (exactly what
 * Razorpay does) and POSTs it to /api/billing/verify, so it upgrades the
 * logged-in user without opening Checkout. Use rzp_test_* keys only.
 *
 * If RAZORPAY_WEBHOOK_SECRET is set it also checks /api/billing/webhook rejects
 * an unsigned call and accepts a signed (harmless) subscription.cancelled event.
 * Subscriptions themselves need a real card mandate, so test those in the
 * browser with Razorpay's test cards.
 */
import 'dotenv/config';
import crypto from 'crypto';

const { RAZORPAY_KEY_ID: keyId = '', RAZORPAY_KEY_SECRET: secret = '' } = process.env;
const base = process.env.NOTEAI_URL || `http://localhost:${process.env.PORT || 8001}`;
const cookie = process.env.NOTEAI_COOKIE;

async function main() {
  if (!keyId || !secret) throw new Error('Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in backend/.env');
  if (!keyId.startsWith('rzp_test_')) throw new Error('Refusing to run with non-test keys');

  let orderId: string;
  if (cookie) {
    const r = await fetch(`${base}/api/billing/order`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ plan: 'pro' }),
    });
    const j: any = await r.json();
    if (!r.ok) throw new Error(`order: ${r.status} ${JSON.stringify(j)}`);
    orderId = j.orderId;
    console.log('backend order:', j);
  } else {
    const auth = 'Basic ' + Buffer.from(`${keyId}:${secret}`).toString('base64');
    const r = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 100, currency: 'INR', receipt: `cli_${Date.now()}` }),
    });
    const j: any = await r.json();
    if (!r.ok) throw new Error(`razorpay: ${r.status} ${JSON.stringify(j)}`);
    console.log('keys OK — razorpay order created:', j.id, j.amount, j.currency, j.status);
    console.log('Set NOTEAI_COOKIE (your browser session cookie) to test the backend flow too.');
    return;
  }

  const paymentId = `pay_cli${Date.now()}`;
  const signature = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  const verify = (sig: string) => fetch(`${base}/api/billing/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sig }),
  }).then(async r => ({ status: r.status, body: await r.json() }));

  console.log('tampered signature →', await verify('0'.repeat(64)));
  console.log('valid signature    →', await verify(signature));
  console.log('replay (no extend) →', await verify(signature));
  await checkWebhook();
}

async function checkWebhook() {
  const whSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!whSecret) return console.log('RAZORPAY_WEBHOOK_SECRET not set — skipping webhook check');
  const body = JSON.stringify({ event: 'subscription.cancelled', payload: { subscription: { entity: { id: 'sub_cli_none' } } } });
  const send = (sig: string) => fetch(`${base}/api/billing/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': sig }, body,
  }).then(r => r.status);
  console.log('webhook unsigned → ', await send('bad'), '(want 400)');
  console.log('webhook signed   → ', await send(crypto.createHmac('sha256', whSecret).update(body).digest('hex')), '(want 200)');
}

main().catch(e => { console.error(e.message); process.exit(1); });
