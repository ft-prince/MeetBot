import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { verifyPaymentSignature, verifySubscriptionSignature, verifyWebhookSignature } from '../src/routes/billing';

// These checks are the only thing stopping a client (or anyone hitting the
// webhook) from claiming a payment that never happened and getting a free upgrade.
const SECRET = 'test_secret';
const hmac = (data: string) => crypto.createHmac('sha256', SECRET).update(data).digest('hex');

test('order: accepts the signature Razorpay would produce', () => {
  assert.equal(verifyPaymentSignature('order_1', 'pay_1', hmac('order_1|pay_1'), SECRET), true);
});

test('order: rejects a different payment, a wrong secret, or garbage', () => {
  assert.equal(verifyPaymentSignature('order_1', 'pay_2', hmac('order_1|pay_1'), SECRET), false);
  assert.equal(verifyPaymentSignature('order_1', 'pay_1', hmac('order_1|pay_1'), 'other'), false);
  assert.equal(verifyPaymentSignature('order_1', 'pay_1', 'short', SECRET), false);
});

test('subscription: signs payment_id|subscription_id (reverse of orders)', () => {
  assert.equal(verifySubscriptionSignature('sub_1', 'pay_1', hmac('pay_1|sub_1'), SECRET), true);
  assert.equal(verifySubscriptionSignature('sub_1', 'pay_1', hmac('sub_1|pay_1'), SECRET), false);
});

test('webhook: signature covers the exact raw body', () => {
  const body = Buffer.from('{"event":"subscription.charged"}');
  assert.equal(verifyWebhookSignature(body, hmac(body.toString()), SECRET), true);
  assert.equal(verifyWebhookSignature(Buffer.from('{"event":"subscription.charged" }'), hmac(body.toString()), SECRET), false);
  assert.equal(verifyWebhookSignature(body, undefined, SECRET), false);
});
