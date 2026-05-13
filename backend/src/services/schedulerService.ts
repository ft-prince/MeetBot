/**
 * Auto-join scheduler — checks every 30 seconds for:
 *   1. Google Calendar events near their start time (per user's auto_join_minutes)
 *   2. User-created scheduled meetings that have hit their scheduled_for time
 */
import { getEventsToAutoJoin, linkMeeting } from './calendarService';
import { getDueScheduledMeetings, markScheduledLaunched } from './scheduledMeetingService';
import { getMeetingIdByCode } from './meetingService';
import { botManager } from '../bot/botManager';

let timer: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
  if (timer) return;
  console.log('[scheduler] Auto-join scheduler started (checking every 30s)');
  timer = setInterval(tick, 30_000);
}

export function stopScheduler(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

async function tick(): Promise<void> {
  await Promise.allSettled([checkCalendarEvents(), checkScheduledMeetings()]);
}

async function checkCalendarEvents(): Promise<void> {
  try {
    const events = await getEventsToAutoJoin();
    for (const ev of events) {
      console.log(`[scheduler] Auto-joining calendar event "${ev.title}" for user ${ev.userId}`);
      try {
        const meetingId = await botManager.launch(ev.meetUrl);
        await linkMeeting(ev.eventId, meetingId);
        console.log(`[scheduler] Launched bot for "${ev.title}" → meeting ${meetingId}`);
      } catch (err) {
        console.error(`[scheduler] Failed to auto-join "${ev.title}":`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error('[scheduler] Calendar check error:', (err as Error).message);
  }
}

async function checkScheduledMeetings(): Promise<void> {
  try {
    const due = await getDueScheduledMeetings();
    for (const s of due) {
      console.log(`[scheduler] Auto-launching scheduled "${s.title}" for user ${s.userId}`);
      try {
        const meetingCode = await botManager.launch(s.meetingUrl, s.userId);
        const dbMeetingId = await getMeetingIdByCode(meetingCode, s.userId);
        await markScheduledLaunched(s.id, dbMeetingId);
        console.log(`[scheduler] Launched scheduled "${s.title}" → ${meetingCode}`);
      } catch (err) {
        console.error(`[scheduler] Failed to launch scheduled "${s.title}":`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error('[scheduler] Scheduled-meetings check error:', (err as Error).message);
  }
}
