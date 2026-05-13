import { db } from '../db/client';
import { v4 as uuidv4 } from 'uuid';
import type { IdentifiedSegment } from './speakerCorrelator';
import type { PipelineResult } from './aiPipelineService';

export interface Meeting {
  id: string;
  meetingCode: string;
  startedAt: Date;
}

export async function createMeeting(meetingCode: string, userId?: string): Promise<Meeting> {
  const result = await db.query(
    `INSERT INTO meetings (id, meeting_code, user_id, started_at)
     VALUES ($1, $2, $3, now())
     RETURNING id, meeting_code, started_at`,
    [uuidv4(), meetingCode, userId || null]
  );
  const row = result.rows[0];
  return { id: row.id, meetingCode: row.meeting_code, startedAt: row.started_at };
}

export async function endMeeting(meetingId: string): Promise<void> {
  await db.query(
    `UPDATE meetings
     SET ended_at = now(),
         duration_ms = EXTRACT(EPOCH FROM (now() - started_at)) * 1000
     WHERE id = $1`,
    [meetingId]
  );
}

export async function saveSummary(
  meetingId: string,
  summary: string,
  keyInsights: string[],
  detailedRewrite = '',
  importantPoints: string[] = []
): Promise<void> {
  await db.query(
    `UPDATE meetings
     SET summary = $1, key_insights = $2,
         metadata = metadata || $3::jsonb
     WHERE id = $4`,
    [
      summary,
      JSON.stringify(keyInsights),
      JSON.stringify({ detailedRewrite, importantPoints }),
      meetingId,
    ]
  );
  console.log(`[meeting] Summary saved for ${meetingId}`);
}

export async function getMeetingSummary(meetingId: string, userId?: string) {
  const result = await db.query(
    `SELECT id, meeting_code, title, summary, key_insights, started_at, ended_at, duration_ms,
            user_id, metadata, processing_status, language
     FROM meetings WHERE id = $1`,
    [meetingId]
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  if (userId && row.user_id && row.user_id !== userId) return null;
  const meta = row.metadata || {};
  return {
    id: row.id,
    meetingCode: row.meeting_code,
    title: row.title,
    summary: row.summary,
    keyInsights: row.key_insights || [],
    detailedRewrite: (meta.detailedRewrite as string) || '',
    importantPoints: (meta.importantPoints as string[]) || [],
    actionItems: (meta.actionItems as unknown[]) || [],
    keyQuestions: (meta.keyQuestions as string[]) || [],
    chapters: (meta.chapters as unknown[]) || [],
    speakerInsights: (meta.speakerInsights as unknown[]) || [],
    processingStatus: row.processing_status || {},
    language: row.language || null,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMs: row.duration_ms,
  };
}

export async function savePipelineResults(
  meetingId: string,
  result: PipelineResult
): Promise<void> {
  const metadataPatch = {
    detailedRewrite: result.detailedRewrite,
    importantPoints: result.importantPoints,
    actionItems: result.actionItems,
    keyQuestions: result.keyQuestions,
    chapters: result.chapters,
    speakerInsights: result.speakerInsights,
  };
  await db.query(
    `UPDATE meetings
     SET summary = $1,
         key_insights = $2,
         metadata = metadata || $3::jsonb,
         processing_status = $4::jsonb,
         language = $5
     WHERE id = $6`,
    [
      result.summary,
      JSON.stringify(result.keyInsights),
      JSON.stringify(metadataPatch),
      JSON.stringify(result.status),
      result.language,
      meetingId,
    ]
  );
  console.log(`[meeting] Pipeline results saved for ${meetingId} (status: ${JSON.stringify(result.status)})`);
}

export async function saveSegment(
  meetingId: string,
  segment: IdentifiedSegment
): Promise<void> {
  await db.query(
    `INSERT INTO transcript_segments
       (id, meeting_id, speaker_label, speaker_name, text, start_ms, end_ms, confidence, word_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO NOTHING`,
    [
      segment.segmentId,
      meetingId,
      segment.speakerLabel,
      segment.speakerName,
      segment.text,
      segment.startMs,
      segment.endMs,
      segment.confidence ?? null,
      segment.words ? JSON.stringify(segment.words) : null,
    ]
  );
}

export async function updateSpeakerName(
  meetingId: string,
  speakerLabel: string,
  speakerName: string
): Promise<void> {
  await db.query(
    `UPDATE transcript_segments
     SET speaker_name = $1
     WHERE meeting_id = $2 AND speaker_label = $3 AND speaker_name IS NULL`,
    [speakerName, meetingId, speakerLabel]
  );
}

export async function appendScreenShareEvent(
  meetingId: string,
  eventType: 'screenshare_start' | 'screenshare_end' | 'screenshare_update',
  presenter: string | null,
  ms: number,
): Promise<void> {
  // Append to metadata.screenshareEvents JSONB array. Idempotent — duplicates allowed
  // since updates may fire; downstream consumers can dedupe by timestamp.
  const entry = { type: eventType, presenter, ms };
  await db.query(
    `UPDATE meetings
     SET metadata = jsonb_set(
       COALESCE(metadata, '{}'::jsonb),
       '{screenshareEvents}',
       COALESCE(metadata->'screenshareEvents', '[]'::jsonb) || $1::jsonb,
       true
     )
     WHERE id = $2`,
    [JSON.stringify(entry), meetingId],
  );
}

export async function logDomEvent(
  meetingId: string,
  speakerName: string,
  eventType: 'start' | 'end',
  eventMs: number
): Promise<void> {
  await db.query(
    `INSERT INTO dom_speaker_events (id, meeting_id, speaker_name, event_type, event_ms)
     VALUES ($1, $2, $3, $4, $5)`,
    [uuidv4(), meetingId, speakerName, eventType, eventMs]
  );
}

export async function getMeetingTranscript(meetingId: string, userId?: string) {
  // Verify ownership before returning transcript
  if (userId) {
    const check = await db.query('SELECT user_id FROM meetings WHERE id = $1', [meetingId]);
    const row = check.rows[0];
    if (!row) return [];
    if (row.user_id && row.user_id !== userId) return null; // null = forbidden
  }
  const result = await db.query(
    `SELECT id, speaker_label, speaker_name, text, start_ms, end_ms, confidence
     FROM transcript_segments
     WHERE meeting_id = $1
     ORDER BY start_ms ASC`,
    [meetingId]
  );
  return result.rows;
}

/**
 * Resolve the DB UUID of the most recent meeting matching a code + user.
 * Used when callers only know the meeting code (e.g. after `botManager.launch`
 * which returns the code, not the UUID).
 */
export async function getMeetingIdByCode(
  meetingCode: string,
  userId?: string,
): Promise<string | null> {
  const result = userId
    ? await db.query(
        `SELECT id FROM meetings
         WHERE meeting_code = $1 AND user_id = $2
         ORDER BY started_at DESC LIMIT 1`,
        [meetingCode, userId],
      )
    : await db.query(
        `SELECT id FROM meetings
         WHERE meeting_code = $1
         ORDER BY started_at DESC LIMIT 1`,
        [meetingCode],
      );
  return result.rows[0]?.id ?? null;
}

export async function listMeetings(userId: string) {
  const result = await db.query(
    `SELECT id, meeting_code, title, started_at, ended_at, duration_ms,
            CASE WHEN summary IS NOT NULL AND summary != '' THEN true ELSE false END AS has_summary
     FROM meetings
     WHERE user_id = $1
     ORDER BY started_at DESC
     LIMIT 50`,
    [userId]
  );
  return result.rows;
}
