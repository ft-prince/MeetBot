/**
 * Scheduled meetings — user-created via "Schedule Meeting" form.
 * Distinct from calendar_events (synced from Google Calendar) and meetings
 * (rows representing actual recordings).
 */
import { db } from '../db/client';
import { v4 as uuidv4 } from 'uuid';

export interface ScheduledMeeting {
  id: string;
  userId: string;
  title: string;
  meetingUrl: string;
  scheduledFor: Date;
  description: string | null;
  autoLaunch: boolean;
  status: 'scheduled' | 'launched' | 'cancelled';
  meetingId: string | null;
  createdAt: Date;
}

export interface ScheduleInput {
  title: string;
  meetingUrl: string;
  scheduledFor: Date;
  description?: string;
  autoLaunch?: boolean;
}

const MEET_URL = /^https?:\/\/meet\.google\.com\/[a-z0-9-]+/i;

export function validateScheduleInput(input: Partial<ScheduleInput>): string | null {
  if (!input.title || input.title.trim().length === 0) return 'Title is required';
  if (input.title.length > 200) return 'Title is too long (max 200 chars)';
  if (!input.meetingUrl || !MEET_URL.test(input.meetingUrl)) {
    return 'A valid Google Meet URL is required (https://meet.google.com/...)';
  }
  if (!input.scheduledFor || isNaN(input.scheduledFor.getTime())) {
    return 'A valid scheduled date/time is required';
  }
  // Allow scheduling up to 5 minutes in the past (clock skew tolerance)
  if (input.scheduledFor.getTime() < Date.now() - 5 * 60_000) {
    return 'Scheduled time must be in the future';
  }
  if (input.description && input.description.length > 2000) {
    return 'Description is too long (max 2000 chars)';
  }
  return null;
}

function rowToModel(row: Record<string, unknown>): ScheduledMeeting {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    title: row.title as string,
    meetingUrl: row.meeting_url as string,
    scheduledFor: row.scheduled_for as Date,
    description: (row.description as string | null) ?? null,
    autoLaunch: row.auto_launch as boolean,
    status: row.status as 'scheduled' | 'launched' | 'cancelled',
    meetingId: (row.meeting_id as string | null) ?? null,
    createdAt: row.created_at as Date,
  };
}

export async function createScheduledMeeting(
  userId: string,
  input: ScheduleInput
): Promise<ScheduledMeeting> {
  const result = await db.query(
    `INSERT INTO scheduled_meetings
       (id, user_id, title, meeting_url, scheduled_for, description, auto_launch)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      uuidv4(),
      userId,
      input.title.trim(),
      input.meetingUrl.trim(),
      input.scheduledFor,
      input.description?.trim() || null,
      input.autoLaunch ?? true,
    ]
  );
  return rowToModel(result.rows[0]);
}

export async function listScheduledMeetings(userId: string): Promise<ScheduledMeeting[]> {
  const result = await db.query(
    `SELECT * FROM scheduled_meetings
     WHERE user_id = $1 AND status != 'cancelled'
     ORDER BY scheduled_for ASC`,
    [userId]
  );
  return result.rows.map(rowToModel);
}

export async function getScheduledMeeting(
  id: string,
  userId: string
): Promise<ScheduledMeeting | null> {
  const result = await db.query(
    `SELECT * FROM scheduled_meetings WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  return result.rows[0] ? rowToModel(result.rows[0]) : null;
}

export async function cancelScheduledMeeting(id: string, userId: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE scheduled_meetings
     SET status = 'cancelled'
     WHERE id = $1 AND user_id = $2 AND status = 'scheduled'
     RETURNING id`,
    [id, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Returns scheduled meetings due for auto-launch.
 * Window: scheduled_for within [now - 30s, now + 60s], status=scheduled, auto_launch=true.
 * Lower bound covers brief scheduler downtime.
 */
export async function getDueScheduledMeetings(): Promise<ScheduledMeeting[]> {
  const result = await db.query(
    `SELECT * FROM scheduled_meetings
     WHERE status = 'scheduled'
       AND auto_launch = true
       AND scheduled_for <= (now() + interval '60 seconds')
       AND scheduled_for >= (now() - interval '30 seconds')`
  );
  return result.rows.map(rowToModel);
}

export async function markScheduledLaunched(id: string, meetingId: string | null): Promise<void> {
  await db.query(
    `UPDATE scheduled_meetings
     SET status = 'launched', meeting_id = $1
     WHERE id = $2`,
    [meetingId, id]
  );
}