import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMeetAlone } from '../src/bot/meetBot';

// Positive-evidence-only alone detection. The bot may only conclude "everyone
// left" from an explicit signal (Meet's banner, or a participant badge of 1).
// Ambiguous DOM states — the exact states real meetings produce during screen
// share, spotlight layouts and long silences — must read as NOT alone.

test('explicit "only one here" banner → alone', () => {
  assert.equal(isMeetAlone({ others: 0, badge: 0, tiles: 1, banner: true }), true);
});

test('participant badge of exactly 1 (just the bot) → alone', () => {
  assert.equal(isMeetAlone({ others: 0, badge: 1, tiles: 1, banner: false }), true);
});

test('badge shows 2+ participants → not alone, regardless of tiles', () => {
  assert.equal(isMeetAlone({ others: 1, badge: 2, tiles: 1, banner: false }), false);
  assert.equal(isMeetAlone({ others: 4, badge: 5, tiles: 0, banner: false }), false);
});

test('REGRESSION: single tile with unreadable badge (screen share / collapsed layout) → NOT alone', () => {
  // This exact state (tiles=1 badge=0 banner=false) caused false AUTO-LEAVEs
  // in production while meetings were still active (bot-diag.log 2026-06-30/07-02).
  assert.equal(isMeetAlone({ others: 0, badge: 0, tiles: 1, banner: false }), false);
});

test('multiple tiles with unreadable badge → not alone', () => {
  assert.equal(isMeetAlone({ others: 2, badge: 0, tiles: 3, banner: false }), false);
});

test('zero tiles and no readable signals (meeting UI gone) → alone', () => {
  assert.equal(isMeetAlone({ others: 0, badge: 0, tiles: 0, banner: false }), true);
});
