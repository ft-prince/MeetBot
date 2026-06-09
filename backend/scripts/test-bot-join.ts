/**
 * Quick live test — launches the inhouse bot against a real meeting URL.
 * On Ctrl+C it stops the bot AND waits for the AI summary pipeline to finish
 * (the pipeline runs in-process and is fire-and-forget in production, so here
 * we poll the DB until the summary lands before exiting).
 *
 * Usage:
 *   npx tsx scripts/test-bot-join.ts https://meet.google.com/abc-defg-hij
 */
import '../src/config';
import { Pool } from 'pg';
import { config } from '../src/config';
import { botManager } from '../src/bot/botManager';

const SUMMARY_WAIT_MS = 90_000;
const POLL_MS = 2_000;

async function waitForSummary(meetingCode: string): Promise<void> {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const deadline = Date.now() + SUMMARY_WAIT_MS;
  try {
    while (Date.now() < deadline) {
      const { rows } = await pool.query(
        `SELECT summary FROM meetings
          WHERE meeting_code = $1 AND summary IS NOT NULL AND summary <> ''
          ORDER BY started_at DESC LIMIT 1`,
        [meetingCode]
      );
      if (rows[0]?.summary) {
        console.log('\n[test] ✅ Summary generated:\n   ', rows[0].summary.slice(0, 300));
        return;
      }
      await new Promise(r => setTimeout(r, POLL_MS));
    }
    console.warn('[test] ⚠ Summary not generated within timeout (maybe no speech captured).');
  } finally {
    await pool.end();
  }
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: npx tsx scripts/test-bot-join.ts <meeting-url>');
    process.exit(1);
  }

  console.log('[test] Launching bot for', url, `(STT=${config.sttEngine})`);
  const meetingId = await botManager.launch(url);
  console.log('[test] meetingId =', meetingId);
  console.log('[test] Bot running — press Ctrl+C to stop & summarize');

  let stopping = false;
  process.on('SIGINT', async () => {
    if (stopping) return;
    stopping = true;
    console.log('\n[test] Stopping bot …');
    await botManager.stop(meetingId);
    await waitForSummary(meetingId);
    process.exit(0);
  });
}

main().catch(err => { console.error('[test] fatal:', err); process.exit(1); });
