/**
 * End-to-end test: stream PCM into the REAL backend /audio WebSocket and verify
 * the AIKosh STT engine transcribes it and the segment lands in Postgres.
 *
 * Exercises the production path: ingestHandler → createSttClient(aikosh)
 *   → aikosh_service.py (:3003) → SpeakerCorrelator → saveSegment → DB
 *
 * Usage: npx tsx scripts/test-aikosh-e2e.ts /tmp/test_16k.wav
 */
import '../src/config';
import WebSocket from 'ws';
import fs from 'fs';
import { Pool } from 'pg';
import { config } from '../src/config';

const WAV = process.argv[2] || '/tmp/test_16k.wav';
const MEETING = `aikosh-e2e-${Date.now()}`;
const BACKEND = `ws://localhost:8001/audio?meetingId=${MEETING}`;
const SEND_CHUNK_MS = 200;
const SAMPLE_RATE = 16000;

function readPcmFromWav(path: string): Buffer {
  const buf = fs.readFileSync(path);
  // Skip the 44-byte WAV header → raw Int16 PCM
  return buf.subarray(44);
}

async function main() {
  console.log(`[e2e] STT engine = ${config.sttEngine}`);
  if (config.sttEngine !== 'aikosh') {
    console.warn('[e2e] ⚠ STT_ENGINE is not "aikosh" — restart backend with STT_ENGINE=aikosh');
  }
  const pcm = readPcmFromWav(WAV);
  const bytesPerChunk = SAMPLE_RATE * 2 * (SEND_CHUNK_MS / 1000); // int16 = 2 bytes
  console.log(`[e2e] ${WAV} → ${pcm.length} PCM bytes (~${(pcm.length / 2 / SAMPLE_RATE).toFixed(1)}s)`);

  const ws = new WebSocket(BACKEND);
  await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
  console.log(`[e2e] connected to backend, meeting=${MEETING}`);

  for (let off = 0; off < pcm.length; off += bytesPerChunk) {
    ws.send(pcm.subarray(off, off + bytesPerChunk));
    await new Promise(r => setTimeout(r, SEND_CHUNK_MS));
  }
  console.log('[e2e] audio streamed; waiting 6s for trailing transcripts…');
  await new Promise(r => setTimeout(r, 6000));
  ws.close();

  // Check DB for segments
  const pool = new Pool({ connectionString: config.databaseUrl });
  const { rows } = await pool.query(
    `SELECT ts.speaker_name, ts.text, ts.start_ms
       FROM transcript_segments ts
       JOIN meetings m ON m.id = ts.meeting_id
      WHERE m.meeting_code = $1
      ORDER BY ts.start_ms ASC`,
    [MEETING]
  );
  await pool.end();

  console.log(`\n══════════════════════════════════════════════`);
  if (rows.length > 0) {
    console.log(`✅ PASS — ${rows.length} segment(s) transcribed via AIKosh + saved to DB:`);
    for (const r of rows) console.log(`   [${r.start_ms}ms] ${r.text}`);
  } else {
    console.log('❌ FAIL — no segments in DB for this meeting');
    process.exitCode = 1;
  }
  console.log(`══════════════════════════════════════════════\n`);
  process.exit(process.exitCode ?? 0);
}

main().catch(err => { console.error('[e2e] fatal:', err); process.exit(1); });
