/**
 * Auto-join scheduler — checks every 60 seconds for calendar events
 * that should be joined automatically based on user's auto_join_minutes setting.
 */
import { getEventsToAutoJoin, linkMeeting } from './calendarService';
import { botManager } from '../bot/botManager';

let timer: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
  if (timer) return;
  console.log('[scheduler] Auto-join scheduler started (checking every 60s)');
  timer = setInterval(checkAndJoin, 60_000);
}

export function stopScheduler(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

async function checkAndJoin(): Promise<void> {
  try {
    const events = await getEventsToAutoJoin();
    for (const ev of events) {
      console.log(`[scheduler] Auto-joining "${ev.title}" for user ${ev.userId}`);
      try {
        const meetingId = await botManager.launch(ev.meetUrl);
        await linkMeeting(ev.eventId, meetingId);
        console.log(`[scheduler] Launched bot for "${ev.title}" → meeting ${meetingId}`);
      } catch (err) {
        console.error(`[scheduler] Failed to auto-join "${ev.title}":`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error('[scheduler] Check error:', (err as Error).message);
  }
}
