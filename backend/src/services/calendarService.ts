import { google } from 'googleapis';
import { getAuthedClient } from './googleAuth';
import { db } from '../db/client';
import { v4 as uuidv4 } from 'uuid';

export interface CalendarEvent {
  id: string;
  googleEventId: string;
  title: string;
  meetUrl: string;
  startTime: Date;
  endTime: Date;
  attendees: { name?: string; email: string }[];
  autoJoin: boolean;
  meetingId?: string;
}

const MEET_REGEX = /https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i;

/** Fetch upcoming Google Meet events for the next 25 days and upsert into DB */
export async function syncCalendar(userId: string): Promise<CalendarEvent[]> {
  const auth = await getAuthedClient(userId);
  const calendar = google.calendar({ version: 'v3', auth });

  // If the user has global auto-bot-join enabled in their profile, NEW calendar
  // events default to auto_join=true. Existing rows' auto_join is preserved by
  // the ON CONFLICT clause below (so individual user opt-outs aren't clobbered).
  const userRow = await db.query<{ auto_join_minutes: number }>(
    'SELECT auto_join_minutes FROM users WHERE id = $1',
    [userId],
  );
  const defaultAutoJoin = (userRow.rows[0]?.auto_join_minutes ?? 0) > 0;

  const now = new Date();
  const until = new Date();
  until.setDate(until.getDate() + 25);

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: until.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 100,
  });

  const items = res.data.items || [];
  const events: CalendarEvent[] = [];

  for (const item of items) {
    const meetUrl = extractMeetUrl(item);
    if (!meetUrl) continue;

    const startTime = new Date(item.start?.dateTime || item.start?.date || '');
    const endTime   = new Date(item.end?.dateTime   || item.end?.date   || '');
    if (isNaN(startTime.getTime())) continue;

    const attendees = (item.attendees || []).map((a) => ({
      email: a.email || '',
      name: a.displayName,
    }));

    // Upsert into calendar_events — preserve auto_join on existing rows so we
    // don't clobber a user's per-event opt-out. NEW rows inherit auto_join from
    // the user's global setting (defaultAutoJoin).
    const result = await db.query(
      `INSERT INTO calendar_events
         (id, user_id, google_event_id, title, meet_url, start_time, end_time, attendees, auto_join, synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
       ON CONFLICT (user_id, google_event_id) DO UPDATE SET
         title      = EXCLUDED.title,
         meet_url   = EXCLUDED.meet_url,
         start_time = EXCLUDED.start_time,
         end_time   = EXCLUDED.end_time,
         attendees  = EXCLUDED.attendees,
         synced_at  = now()
       RETURNING *`,
      [
        uuidv4(),
        userId,
        item.id,
        item.summary || 'Untitled Meeting',
        meetUrl,
        startTime,
        endTime,
        JSON.stringify(attendees),
        defaultAutoJoin,
      ]
    );

    events.push(rowToEvent(result.rows[0]));
  }

  console.log(`[calendar] Synced ${events.length} Meet events for user ${userId}`);
  return events;
}

/**
 * Get calendar events for a user — both past (last 30 days) and all future.
 * The frontend computes status (Done / Live / Upcoming) from start_time/end_time/meeting_id
 * and groups them accordingly. The Dashboard further filters this client-side to
 * future-only events for its "Upcoming Meetings" panel.
 */
export async function getUpcomingEvents(userId: string): Promise<CalendarEvent[]> {
  const result = await db.query(
    `SELECT * FROM calendar_events
     WHERE user_id = $1
       AND start_time >= (now() - interval '30 days')
     ORDER BY start_time ASC
     LIMIT 200`,
    [userId]
  );
  return result.rows.map(rowToEvent);
}

/** Toggle auto-join for a specific event */
export async function setAutoJoin(
  userId: string,
  eventId: string,
  autoJoin: boolean
): Promise<void> {
  await db.query(
    `UPDATE calendar_events SET auto_join = $1
     WHERE id = $2 AND user_id = $3`,
    [autoJoin, eventId, userId]
  );
}

/** Get all events that should be auto-joined right now */
export async function getEventsToAutoJoin(): Promise<
  { eventId: string; userId: string; meetUrl: string; title: string; autoJoinMinutes: number }[]
> {
  const result = await db.query(
    `SELECT ce.id AS event_id, ce.user_id, ce.meet_url, ce.title,
            u.auto_join_minutes
     FROM calendar_events ce
     JOIN users u ON u.id = ce.user_id
     WHERE ce.auto_join = true
       AND ce.meeting_id IS NULL
       AND ce.start_time BETWEEN now() - interval '1 minute'
                             AND now() + (u.auto_join_minutes || ' minutes')::interval`
  );
  return result.rows.map((r) => ({
    eventId: r.event_id as string,
    userId: r.user_id as string,
    meetUrl: r.meet_url as string,
    title: r.title as string,
    autoJoinMinutes: r.auto_join_minutes as number,
  }));
}

/** Link a calendar event to a launched meeting */
export async function linkMeeting(calendarEventId: string, meetingId: string): Promise<void> {
  await db.query(
    `UPDATE calendar_events SET meeting_id = $1 WHERE id = $2`,
    [meetingId, calendarEventId]
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractMeetUrl(item: any): string | null {
  // 1. hangoutLink (most reliable)
  if (item.hangoutLink) {
    const m = item.hangoutLink.match(MEET_REGEX);
    if (m) return m[0];
  }
  // 2. Conference data entry points
  for (const ep of item.conferenceData?.entryPoints || []) {
    if (ep.entryPointType === 'video' && ep.uri) {
      const m = ep.uri.match(MEET_REGEX);
      if (m) return m[0];
    }
  }
  // 3. Description / location
  for (const field of [item.description, item.location]) {
    if (field) {
      const m = field.match(MEET_REGEX);
      if (m) return m[0];
    }
  }
  return null;
}

function rowToEvent(row: Record<string, unknown>): CalendarEvent {
  return {
    id: row.id as string,
    googleEventId: row.google_event_id as string,
    title: row.title as string,
    meetUrl: row.meet_url as string,
    startTime: new Date(row.start_time as string),
    endTime: new Date(row.end_time as string),
    attendees: (row.attendees as { name?: string; email: string }[]) || [],
    autoJoin: row.auto_join as boolean,
    meetingId: row.meeting_id as string | undefined,
  };
}
