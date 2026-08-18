import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultMeetingTitle } from '../src/services/meetingService';

// The generated fallback title used when a Quick-Join supplies no title.
// Format: "Meeting - YYYY-MM-DD HH:MM" in server local time.

test('default title has the documented shape', () => {
  const t = defaultMeetingTitle(new Date(2026, 6, 3, 9, 5)); // 2026-07-03 09:05 local
  assert.equal(t, 'Meeting - 2026-07-03 09:05');
});

test('default title zero-pads month, day, hour and minute', () => {
  const t = defaultMeetingTitle(new Date(2026, 0, 1, 0, 0)); // 2026-01-01 00:00 local
  assert.equal(t, 'Meeting - 2026-01-01 00:00');
});

test('default title uses 24-hour time', () => {
  const t = defaultMeetingTitle(new Date(2026, 11, 31, 23, 59));
  assert.equal(t, 'Meeting - 2026-12-31 23:59');
});
