// Smoke test for the hardened DeepgramClient (run: npx tsx scripts/test-deepgram-resilience.ts)
//  1. Stream real speech → expect transcripts (normal path still works).
//  2. Stream 60s of silence at 5x realtime → expect no disconnect/churn.
//  3. Stream speech again → expect transcripts to RESUME (post-silence path).
// Exercises the keepalive, the bounded queue and the liveness watchdog against
// the real Deepgram API using the key in .env.
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

async function main() {
  const { DeepgramClient } = await import('../src/ws/deepgramClient');

  const wav = fs.readFileSync(path.resolve(__dirname, '..', 'test_speech.wav'));
  const pcm = wav.subarray(44); // strip WAV header (16k mono s16le)

  const finals: string[] = [];
  const client = new DeepgramClient((seg, isFinal) => {
    if (isFinal) {
      finals.push(`[${seg.startMs}-${seg.endMs}ms] ${seg.text}`);
      console.log('FINAL:', finals[finals.length - 1]);
    }
  }, (err) => console.error('onError:', (err as Error)?.message ?? err));

  client.connect();

  const CHUNK = 6400; // 200ms at 16k s16le
  const sendBuf = async (buf: Buffer, label: string) => {
    console.log(`--- streaming ${label} (${Math.round(buf.length / 32 / 1000)}s of audio)`);
    for (let o = 0; o < buf.length; o += CHUNK) {
      client.sendAudio(buf.subarray(o, Math.min(o + CHUNK, buf.length)));
      await new Promise(r => setTimeout(r, 40)); // 5x realtime
    }
  };

  await new Promise(r => setTimeout(r, 1500)); // let it connect
  await sendBuf(pcm, 'speech pass 1');
  await new Promise(r => setTimeout(r, 3000));
  const afterPass1 = finals.length;
  console.log(`=== pass 1 finals: ${afterPass1}`);

  // 60s of silence (sent at 5x realtime ≈ 12s wall) — must not kill the stream.
  const silence = Buffer.alloc(60 * 32_000);
  await sendBuf(silence, 'silence');

  await sendBuf(pcm, 'speech pass 2 (post-silence resume)');
  await new Promise(r => setTimeout(r, 4000));
  const afterPass2 = finals.length;
  console.log(`=== pass 2 finals: ${afterPass2 - afterPass1} (total ${afterPass2})`);

  client.disconnect();
  const ok = afterPass1 > 0 && afterPass2 > afterPass1;
  console.log(ok ? 'RESULT: PASS — transcription resumed after silence' : 'RESULT: FAIL');
  process.exit(ok ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
