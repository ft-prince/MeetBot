import { db } from '../db/client';
import { v4 as uuidv4 } from 'uuid';
import type { IdentifiedSegment } from './speakerCorrelator';

export interface Meeting {
  id: string;
  meetingCode: string;
  startedAt: Date;
}

export async function createMeeting(meetingCode: string): Promise<Meeting> {
  const result = await db.query(
    `INSERT INTO meetings (id, meeting_code, started_at)
     VALUES ($1, $2, now())
     RETURNING id, meeting_code, started_at`,
    [uuidv4(), meetingCode]
  );
  const row = result.rows[0];
  return {
    id: row.id,
    meetingCode: row.meeting_code,
    startedAt: row.started_at,
  };
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

// Update all segments in a meeting when a label gets resolved to a name
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

export async function getMeetingTranscript(meetingId: string) {
  const result = await db.query(
    `SELECT
       ts.id,
       ts.speaker_label,
       ts.speaker_name,
       ts.text,
       ts.start_ms,
       ts.end_ms,
       ts.confidence
     FROM transcript_segments ts
     WHERE ts.meeting_id = $1
     ORDER BY ts.start_ms ASC`,
    [meetingId]
  );
  return result.rows;
}

export async function listMeetings() {
  const result = await db.query(
    `SELECT id, meeting_code, title, started_at, ended_at, duration_ms
     FROM meetings
     ORDER BY started_at DESC
     LIMIT 50`
  );
  return result.rows;
}
