import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldDropMeetTap, type MeetTapState } from '../src/ws/ingestHandler';

// 200ms of 16kHz 16-bit mono.
const SAMPLES = 16000 * 0.2;

function audibleChunk(): Buffer {
  const b = Buffer.alloc(SAMPLES * 2);
  for (let i = 0; i < SAMPLES; i++) b.writeInt16LE(i % 2 ? 8000 : -8000, i * 2); // loud square wave
  return b;
}
function silentChunk(): Buffer {
  return Buffer.alloc(SAMPLES * 2); // all zeros
}
function fresh(): MeetTapState {
  return { activeMixedTrack: null, activeMixedAudibleAt: 0 };
}

test('real per-participant tracks are never dropped here', () => {
  const s = fresh();
  assert.equal(shouldDropMeetTap(s, 'a1b2c3d4-track-id', audibleChunk(), 1000), false);
  assert.equal(s.activeMixedTrack, null); // untouched
});

test('the first audible synthetic tap is elected and passes', () => {
  const s = fresh();
  assert.equal(shouldDropMeetTap(s, 'wasrc-0', audibleChunk(), 1000), false);
  assert.equal(s.activeMixedTrack, 'wasrc-0');
});

test('silent taps are never elected', () => {
  const s = fresh();
  assert.equal(shouldDropMeetTap(s, 'meet-mixed', silentChunk(), 1000), true);
  assert.equal(s.activeMixedTrack, null);
});

test('REGRESSION: silent meet-mixed must not steal the stream from audible wasrc', () => {
  // Real Meet: meet-mixed elementRMS=0 all call, speech arrives on wasrc-3.
  const s = fresh();
  let passed = 0;
  for (let t = 1000; t < 6000; t += 200) {
    shouldDropMeetTap(s, 'meet-mixed', silentChunk(), t);           // silent tap every chunk
    if (!shouldDropMeetTap(s, 'wasrc-3', audibleChunk(), t)) passed++;
  }
  assert.equal(s.activeMixedTrack, 'wasrc-3');
  assert.equal(passed, 25); // every speech chunk reached STT
});

test('a duplicate audible tap is dropped while the elected tap is live', () => {
  const s = fresh();
  shouldDropMeetTap(s, 'wasrc-3', audibleChunk(), 1000);
  assert.equal(shouldDropMeetTap(s, 'wasrc-4', audibleChunk(), 1200), true); // same audio, 2nd tap
});

test('the elected tap keeps receiving silence (continuous stream to Deepgram)', () => {
  const s = fresh();
  shouldDropMeetTap(s, 'wasrc-3', audibleChunk(), 1000);
  assert.equal(shouldDropMeetTap(s, 'wasrc-3', silentChunk(), 1200), false);
  assert.equal(s.activeMixedAudibleAt, 1000); // silence doesn't refresh liveness
});

test('another audible tap takes over after the elected tap goes quiet', () => {
  const s = fresh();
  shouldDropMeetTap(s, 'wasrc-0', audibleChunk(), 1000);
  assert.equal(shouldDropMeetTap(s, 'wasrc-1', audibleChunk(), 1000 + 4001), false);
  assert.equal(s.activeMixedTrack, 'wasrc-1');
});
