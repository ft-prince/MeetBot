import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSyncDays, SYNC_WINDOW_OPTIONS, DEFAULT_SYNC_DAYS } from '../src/services/emailService';

// The sync window bounds both the Gmail fetch and which threads get sent to the
// LLM, so a bad value must never widen it — it snaps to the nearest allowed
// option instead of being trusted or throwing.

test('allowed windows pass through unchanged', () => {
  for (const days of SYNC_WINDOW_OPTIONS) {
    assert.equal(normalizeSyncDays(days), days);
  }
});

test('numeric strings from query params are accepted', () => {
  assert.equal(normalizeSyncDays('15'), 15);
});

test('an out-of-range value snaps to the nearest option, never wider', () => {
  assert.equal(normalizeSyncDays(3650), 30);   // "sync my whole mailbox" is capped
  assert.equal(normalizeSyncDays(0), 10);
  assert.equal(normalizeSyncDays(-5), 10);
});

test('a value between options snaps to the closer one', () => {
  assert.equal(normalizeSyncDays(11), 10);
  assert.equal(normalizeSyncDays(14), 15);
  assert.equal(normalizeSyncDays(20), 15);
  assert.equal(normalizeSyncDays(26), 30);
});

test('garbage falls back to the default rather than NaN', () => {
  assert.equal(normalizeSyncDays(undefined), DEFAULT_SYNC_DAYS);
  assert.equal(normalizeSyncDays(null), DEFAULT_SYNC_DAYS);
  assert.equal(normalizeSyncDays('all'), DEFAULT_SYNC_DAYS);
  assert.equal(normalizeSyncDays({}), DEFAULT_SYNC_DAYS);
});
