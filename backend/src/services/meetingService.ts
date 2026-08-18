import { db } from '../db/client';
import { v4 as uuidv4 } from 'uuid';
import type { IdentifiedSegment } from './speakerCorrelator';
import type { PipelineResult } from './aiPipelineService';

export interface Meeting {
  id: string;
  meetingCode: string;
  title: string;
  startedAt: Date;
}

/**
 * Human-friendly fallback title used when the caller doesn't supply one (e.g. a
 * bare Quick-Join with no title). Format: "Meeting - YYYY-MM-DD HH:MM" in server
 * local time. Calendar/scheduled launches always pass a real title, so this only
 * applies to ad-hoc joins.
 */
export function defaultMeetingTitle(when: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `Meeting - ${when.getFullYear()}-${p(when.getMonth() + 1)}-${p(when.getDate())} ` +
    `${p(when.getHours())}:${p(when.getMinutes())}`;
}

export async function createMeeting(
  meetingCode: string,
  userId?: string,
  title?: string,
): Promise<Meeting> {
  const finalTitle = (title && title.trim()) || defaultMeetingTitle();
  const result = await db.query(
    `INSERT INTO meetings (id, meeting_code, title, user_id, started_at)
     VALUES ($1, $2, $3, $4, now())
     RETURNING id, meeting_code, title, started_at`,
    [uuidv4(), meetingCode, finalTitle, userId || null]
  );
  const row = result.rows[0];
  return { id: row.id, meetingCode: row.meeting_code, title: row.title, startedAt: row.started_at };
}

/**
 * Rename a meeting. Ownership-checked: only the owner (or an owner-less legacy
 * meeting) can be edited. Returns the saved title, or null if not found/forbidden.
 * An empty/blank title falls back to the generated default so a meeting is never
 * left with no title.
 */
export async function updateMeetingTitle(
  meetingId: string,
  userId: string,
  title: string,
): Promise<string | null> {
  const clean = (title || '').trim().slice(0, 200) || defaultMeetingTitle();
  const result = await db.query(
    `UPDATE meetings SET title = $1
     WHERE id = $2 AND (user_id = $3 OR user_id IS NULL)
     RETURNING title`,
    [clean, meetingId, userId]
  );
  return result.rows[0]?.title ?? null;
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
    meetingObjective: (meta.meetingObjective as string) || '',
    discussionPoints: (meta.discussionPoints as string[]) || [],
    decisions: (meta.decisions as string[]) || [],
    risks: (meta.risks as string[]) || [],
    followUps: (meta.followUps as string[]) || [],
    nextMeeting: (meta.nextMeeting as string) || null,
    outcome: (meta.outcome as string) || '',
    qaPairs: (meta.qaPairs as { question: string; answer: string | null; askedBy: string | null }[]) || [],
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
    meetingObjective: result.meetingObjective,
    discussionPoints: result.discussionPoints,
    decisions: result.decisions,
    risks: result.risks,
    followUps: result.followUps,
    nextMeeting: result.nextMeeting,
    outcome: result.outcome,
    qaPairs: result.qaPairs,
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

/**
 * Bulk-persist many finalized segments in a single statement, skipping any whose
 * id already exists (ON CONFLICT DO NOTHING). Used as the end-of-meeting flush so
 * the complete transcript is guaranteed saved even if individual live writes
 * failed. Returns the number of rows actually inserted.
 */
export async function saveSegmentsBulk(
  meetingId: string,
  segments: IdentifiedSegment[]
): Promise<number> {
  if (segments.length === 0) return 0;

  const cols = 9;
  // Postgres allows at most 65535 bound params per statement. Chunk well under
  // that so even multi-hour meetings flush in one call each.
  const CHUNK = 1000;
  let inserted = 0;

  for (let start = 0; start < segments.length; start += CHUNK) {
    const chunk = segments.slice(start, start + CHUNK);
    const valuesSql: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((seg, i) => {
      const b = i * cols;
      valuesSql.push(
        `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9})`
      );
      params.push(
        seg.segmentId,
        meetingId,
        seg.speakerLabel,
        seg.speakerName,
        seg.text,
        seg.startMs,
        seg.endMs,
        seg.confidence ?? null,
        seg.words ? JSON.stringify(seg.words) : null,
      );
    });

    const result = await db.query(
      `INSERT INTO transcript_segments
         (id, meeting_id, speaker_label, speaker_name, text, start_ms, end_ms, confidence, word_data)
       VALUES ${valuesSql.join(', ')}
       ON CONFLICT (id) DO NOTHING`,
      params,
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
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

/**
 * Overwrite the speaker name on EVERY segment carrying a label — including
 * segments already tagged with a provisional (possibly wrong) name. Used when
 * co-occurrence voting confidently binds a diarized speaker to a real
 * participant: earlier segments attributed via the transient "current speaker"
 * fallback get corrected retroactively so one person never keeps two names.
 */
export async function rebindSpeakerName(
  meetingId: string,
  speakerLabel: string,
  speakerName: string
): Promise<number> {
  const result = await db.query(
    `UPDATE transcript_segments
     SET speaker_name = $1
     WHERE meeting_id = $2 AND speaker_label = $3
       AND (speaker_name IS NULL OR speaker_name IS DISTINCT FROM $1)`,
    [speakerName, meetingId, speakerLabel]
  );
  return result.rowCount ?? 0;
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

/**
 * Mark a meeting as viewed by its owner. Idempotent — keeps the FIRST view
 * timestamp. A viewed meeting never receives unread-reminder emails.
 */
export async function markMeetingViewed(meetingId: string, userId: string): Promise<void> {
  await db.query(
    `UPDATE meetings SET viewed_at = now()
     WHERE id = $1 AND viewed_at IS NULL
       AND (user_id = $2 OR user_id IS NULL)`,
    [meetingId, userId]
  );
}

export async function markSummaryEmailSent(meetingId: string): Promise<void> {
  await db.query(`UPDATE meetings SET summary_email_sent_at = now() WHERE id = $1`, [meetingId]);
}

export async function markReminderSent(meetingId: string): Promise<void> {
  await db.query(`UPDATE meetings SET reminder_sent_at = now() WHERE id = $1`, [meetingId]);
}

/**
 * Completed meetings whose owner has never opened them, older than `hours`,
 * that haven't had a reminder yet. One reminder per meeting. Capped to
 * meetings ended within the last 7 days so enabling the feature on an
 * existing installation doesn't blast reminders for months-old meetings.
 */
export async function getMeetingsNeedingReminder(hours: number): Promise<
  { id: string; title: string | null; meetingCode: string; endedAt: Date; ownerEmail: string; ownerName: string }[]
> {
  const result = await db.query(
    `SELECT m.id, m.title, m.meeting_code, m.ended_at, u.email AS owner_email, u.name AS owner_name
     FROM meetings m
     JOIN users u ON u.id = m.user_id
     WHERE m.ended_at IS NOT NULL
       AND m.viewed_at IS NULL
       AND m.reminder_sent_at IS NULL
       AND m.summary IS NOT NULL AND m.summary != ''
       AND m.ended_at < now() - ($1::float8 * interval '1 hour')
       AND m.ended_at > now() - interval '7 days'
     ORDER BY m.ended_at ASC
     LIMIT 100`,
    [hours]
  );
  return result.rows.map(r => ({
    id: r.id,
    title: r.title,
    meetingCode: r.meeting_code,
    endedAt: r.ended_at,
    ownerEmail: r.owner_email,
    ownerName: r.owner_name,
  }));
}

/**
 * Everything the post-meeting email + PDF report need, in one shape:
 * meeting row, full AI outputs, owner contact, and the participant list
 * derived from transcript speaker names.
 */
export async function getMeetingReportData(meetingId: string) {
  const summary = await getMeetingSummary(meetingId);
  if (!summary) return null;

  const ownerRes = await db.query(
    `SELECT u.email, u.name FROM meetings m JOIN users u ON u.id = m.user_id WHERE m.id = $1`,
    [meetingId]
  );
  const owner = ownerRes.rows[0]
    ? { email: ownerRes.rows[0].email as string, name: ownerRes.rows[0].name as string }
    : null;

  const speakersRes = await db.query(
    `SELECT DISTINCT COALESCE(speaker_name, speaker_label) AS name
     FROM transcript_segments WHERE meeting_id = $1 AND COALESCE(speaker_name, speaker_label) IS NOT NULL
     ORDER BY 1`,
    [meetingId]
  );
  const participants: string[] = speakersRes.rows.map(r => r.name as string);

  return { ...summary, owner, participants };
}

export type MeetingReportData = NonNullable<Awaited<ReturnType<typeof getMeetingReportData>>>;

export async function listMeetings(userId: string) {
  const result = await db.query(
    `SELECT m.id, m.meeting_code, m.title, m.started_at, m.ended_at, m.duration_ms,
            CASE WHEN m.summary IS NOT NULL AND m.summary != '' THEN true ELSE false END AS has_summary,
            COALESCE(p.participants, '{}') AS participants
     FROM meetings m
     LEFT JOIN LATERAL (
       SELECT array_agg(DISTINCT COALESCE(speaker_name, speaker_label) ORDER BY COALESCE(speaker_name, speaker_label)) AS participants
       FROM transcript_segments
       WHERE meeting_id = m.id AND COALESCE(speaker_name, speaker_label) IS NOT NULL
     ) p ON true
     WHERE m.user_id = $1
     ORDER BY m.started_at DESC
     LIMIT 50`,
    [userId]
  );
  return result.rows;
}
