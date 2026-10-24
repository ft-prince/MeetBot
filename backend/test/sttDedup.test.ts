import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDuplicateFinal, normalizeFinalText } from '../src/ws/ingestHandler';

type RecentFinals = Map<string, { at: number; trackId: string }>;

test('normalizeFinalText lowercases, collapses spaces, strips trailing punctuation', () => {
  assert.equal(normalizeFinalText('  Hello   Guys. '), 'hello guys');
  assert.equal(normalizeFinalText('रोहित चंदन।'), 'रोहित चंदन');
});

test('same utterance from a DIFFERENT track within the window is a duplicate', () => {
  const m: RecentFinals = new Map();
  const t = 1000;
  assert.equal(isDuplicateFinal(m, 'wasrc-0', 'Hello guys', t), false); // first wins
  assert.equal(isDuplicateFinal(m, 'meet-mixed', 'hello guys.', t + 500), true); // parallel copy dropped
  assert.equal(isDuplicateFinal(m, 'track-xyz', 'Hello Guys', t + 900), true); // 3rd path dropped
});

test('a genuine repeat on the SAME track is NOT dropped', () => {
  const m: RecentFinals = new Map();
  assert.equal(isDuplicateFinal(m, 'wasrc-0', 'hello', 1000), false);
  assert.equal(isDuplicateFinal(m, 'wasrc-0', 'hello', 1500), false); // same track → keep
});

test('same text from another track AFTER the window expires is kept', () => {
  const m: RecentFinals = new Map();
  assert.equal(isDuplicateFinal(m, 'wasrc-0', 'hello', 1000), false);
  assert.equal(isDuplicateFinal(m, 'meet-mixed', 'hello', 1000 + 8001), false); // stale → not a dup
});

test('empty / whitespace-only finals are suppressed', () => {
  const m: RecentFinals = new Map();
  assert.equal(isDuplicateFinal(m, 'wasrc-0', '   ', 1000), true);
});
