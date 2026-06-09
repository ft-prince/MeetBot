/**
 * Re-run the AI pipeline for an existing meeting and persist the results.
 * Usage: npx tsx scripts/resummarize.ts <meeting-uuid>
 */
import '../src/config';
import { getMeetingTranscript, savePipelineResults } from '../src/services/meetingService';
import { runPipeline } from '../src/services/aiPipelineService';

async function main() {
  const meetingId = process.argv[2];
  if (!meetingId) {
    console.error('Usage: npx tsx scripts/resummarize.ts <meeting-uuid>');
    process.exit(1);
  }

  const segments = await getMeetingTranscript(meetingId);
  if (!segments || segments.length === 0) {
    console.log('[resummarize] No segments found — nothing to do.');
    process.exit(0);
  }
  console.log(`[resummarize] Running pipeline on ${segments.length} segments…`);

  const result = await runPipeline(
    segments.map((s: Record<string, unknown>) => ({
      speakerName: s.speaker_name as string | null,
      speakerLabel: s.speaker_label as string,
      text: s.text as string,
      startMs: s.start_ms as number,
      endMs: s.end_ms as number,
    })),
  );

  await savePipelineResults(meetingId, result);
  const ok = Object.values(result.status).filter(s => s === 'ok').length;
  console.log(`[resummarize] Done — ${ok} modules ok`);
  console.log('[resummarize] summary:', result.summary?.slice(0, 200));
  process.exit(0);
}

main().catch(err => { console.error('[resummarize] fatal:', err); process.exit(1); });
