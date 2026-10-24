/**
 * End-to-end check of Google Meet tap selection against LIVE Deepgram.
 *
 * Replays the exact tap pattern seen on a real Meet call:
 *   - `meet-mixed` element tap: silent for the whole call
 *   - `wasrc-3` and `wasrc-4`: the SAME speech, duplicated (two Web-Audio taps)
 *   - `wasrc-1`: silent
 * and asserts every utterance is transcribed, and transcribed exactly once.
 *
 * Usage: npx tsx scripts/test-meet-taps-e2e.ts
 * Needs deepgram_api_key in .env and macOS `say` + ffmpeg. Writes one test
 * meeting ("e2e-meet-taps-<ts>") to the configured DATABASE_URL.
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createBotSession, forwardTrackAudio, endBotSessionNoSummary } from '../src/ws/ingestHandler';

const CHUNK_BYTES = 16000 * 2 * 0.2; // 200ms of 16kHz s16le mono, same as the injector
const PHRASES: Array<{ voice: string; text: string }> = [
  { voice: 'Aman', text: 'Hello guys, this is Prince. Everything is going good.' },
  { voice: 'Lekha', text: 'ठीक है, हम यहां रुक सकते हैं, आगे हमें क्या करना है।' },
  { voice: 'Aman', text: 'Thank you, let us see what happens next.' },
];

function synth(dir: string, i: number, voice: string, text: string): Buffer {
  const aiff = path.join(dir, `p${i}.aiff`);
  const pcm = path.join(dir, `p${i}.pcm`);
  execFileSync('say', ['-v', voice, '-o', aiff, text]);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', aiff, '-ac', '1', '-ar', '16000', '-f', 's16le', pcm]);
  return readFileSync(pcm);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main(): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), 'meet-taps-'));
  const silence = (ms: number) => Buffer.alloc(Math.round(16 * 2 * ms));
  // Speech with 2s gaps between phrases, plus lead-in and tail silence.
  const parts: Buffer[] = [silence(1000)];
  PHRASES.forEach((p, i) => { parts.push(synth(dir, i, p.voice, p.text), silence(2000)); });
  parts.push(silence(3000));
  const speech = Buffer.concat(parts);

  // Capture finals from the pipeline's own log line (emitted right before broadcast).
  const finals: Array<{ track: string; text: string }> = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    const line = args.map(String).join(' ');
    const m = line.match(/^\[transcript\] (\S+) .*?: (.*?) \(→/);
    if (m) finals.push({ track: m[1], text: m[2] });
    origLog(...args);
  };

  const code = `e2e-meet-taps-${Date.now()}`;
  await createBotSession(code, undefined, 'E2E meet tap selection');

  // Stream in real time, 200ms per chunk, all four taps per tick like the injector.
  const zero = Buffer.alloc(CHUNK_BYTES);
  const play = async (audio: Buffer, speechTaps: string[], silentTaps: string[]) => {
    for (let off = 0; off < audio.length; off += CHUNK_BYTES) {
      const chunk = Buffer.alloc(CHUNK_BYTES);
      audio.copy(chunk, 0, off, Math.min(off + CHUNK_BYTES, audio.length));
      for (const t of silentTaps) forwardTrackAudio(code, zero, t);
      for (const t of speechTaps) forwardTrackAudio(code, Buffer.from(chunk), t);
      await sleep(200);
    }
  };
  // Phase 1: silent meet-mixed + wasrc-1, the same speech duplicated on wasrc-3/4.
  await play(speech, ['wasrc-3', 'wasrc-4'], ['meet-mixed', 'wasrc-1']);
  // Phase 2 (takeover): after the pause, Meet's audio moves to a different tap.
  const phase2 = Buffer.concat([synth(dir, 99, 'Aman', 'Hello again, the audio moved to another tap.'), silence(3000)]);
  await play(phase2, ['wasrc-0'], ['meet-mixed', 'wasrc-3', 'wasrc-4']);
  await sleep(4000); // let the last finals arrive
  await endBotSessionNoSummary(code);
  console.log = origLog;

  console.log('\n──── FINALS ────');
  for (const f of finals) console.log(`  [${f.track}] ${f.text}`);

  const tracks = new Set(finals.map(f => f.track));
  const texts = finals.map(f => f.text.toLowerCase());
  const uniqueTexts = new Set(texts);
  const all = texts.join(' ');
  const checks: Array<[string, boolean]> = [
    ['got transcripts at all', finals.length > 0],
    ['phase 1 only from ONE of the duplicate taps', !(tracks.has('wasrc-3') && tracks.has('wasrc-4'))],
    ['silent taps never transcribed', !tracks.has('meet-mixed') && !tracks.has('wasrc-1')],
    ['no identical duplicate lines', uniqueTexts.size === texts.length],
    ['first word of the meeting kept ("hello guys")', all.includes('hello guys')],
    ['Hindi phrase heard', /[ऀ-ॿ]/.test(all)],
    ['phase 1 last phrase heard', all.includes('thank')],
    ['takeover: new tap transcribed after pause', tracks.has('wasrc-0') && all.includes('another')],
    ['takeover: first word on the new tap kept ("hello again")', all.includes('hello again')],
  ];
  console.log('\n──── CHECKS ────');
  let ok = true;
  for (const [name, pass] of checks) { console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}`); ok &&= pass; }
  console.log(ok ? '\nALL PASS' : '\nFAILED');
  process.exit(ok ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
