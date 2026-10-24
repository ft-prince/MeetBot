/**
 * Auto-join scheduler — checks every 30 seconds for:
 *   1. Google Calendar events near their start time (per user's auto_join_minutes)
 *   2. User-created scheduled meetings that have hit their scheduled_for time
 */
import { getEventsToAutoJoin, linkMeeting } from './calendarService';
import { getDueScheduledMeetings, markScheduledLaunched } from './scheduledMeetingService';
import { getMeetingIdByCode, getMeetingsNeedingReminder } from './meetingService';
import { sendAdminAlert, sendMeetingReminderEmail, smtpConfigured } from './notificationService';
import { checkAndRefreshMeetSession } from '../bot/sessionKeeper';
import { botManager } from '../bot/botManager';
import { config } from '../config';
import { db } from '../db/client';
import { syncEmails } from './emailService';
import { analyzeUnanalyzedThreads, detectFollowUps } from './emailAnalysisService';

let timer: ReturnType<typeof setInterval> | null = null;
let lastDailyEmailSync = 0;
let lastReminderCheck = 0;

export function startScheduler(): void {
  if (timer) return;
  console.log('[scheduler] Auto-join scheduler started (checking every 30s)');
  timer = setInterval(tick, 30_000);
}

export function stopScheduler(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

async function tick(): Promise<void> {
  await Promise.allSettled([
    checkCalendarEvents(),
    checkScheduledMeetings(),
    dailyEmailSync(),
    checkUnviewedMeetingReminders(),
    keepBotSessionAlive(),
  ]);
}

// ── Bot Google-session keep-alive ────────────────────────────────────────────
// Opens the Meet bot's saved profile every 12h (first run ~2 min after boot) so
// the Google session stays in use and refreshed cookies are saved, and alerts the
// admin if the bot has been signed out. Skipped while any bot is in a meeting
// (they share the profile); it simply retries on a later tick.
const SESSION_KEEPALIVE_INTERVAL_MS = 12 * 60 * 60 * 1000;
const SESSION_FIRST_CHECK_DELAY_MS = 2 * 60 * 1000;
const SESSION_ALERT_REPEAT_MS = 24 * 60 * 60 * 1000;
const schedulerStartedAt = Date.now();
let lastSessionCheck = 0;
let lastSessionAlert = 0;
let sessionCheckRunning = false;

async function keepBotSessionAlive(): Promise<void> {
  const now = Date.now();
  if (sessionCheckRunning) return;
  if (now - schedulerStartedAt < SESSION_FIRST_CHECK_DELAY_MS) return;
  if (lastSessionCheck && now - lastSessionCheck < SESSION_KEEPALIVE_INTERVAL_MS) return;
  if (botManager.active().length > 0) return; // profile in use by a live bot

  sessionCheckRunning = true;
  try {
    const status = await checkAndRefreshMeetSession();
    if (!status) return; // no profile / busy → retry next tick
    lastSessionCheck = Date.now();
    if (status.signedIn) {
      console.log(`[session-keeper] Bot Google session OK — ${status.account ?? 'account'} ("${status.profile}")`);
      lastSessionAlert = 0;
      return;
    }
    console.error(`[session-keeper] Bot is LOGGED OUT of Google ("${status.profile}") — ${status.finalUrl}`);
    if (now - lastSessionAlert >= SESSION_ALERT_REPEAT_MS) {
      lastSessionAlert = now;
      await sendAdminAlert(
        'Meeting bot is signed out of Google',
        `The MeetMaster bot's Google session has ended (profile "${status.profile}", ` +
        `account ${status.account ?? 'unknown'}).\n\nUntil it is signed in again the bot can only join ` +
        `meetings that allow guests. Re-run the bot login (bot-login.ts / bot-login-docker.sh over VNC).\n\n` +
        `Checked at ${status.checkedAt}. Final URL: ${status.finalUrl}`,
      );
    }
  } catch (err) {
    console.error('[session-keeper] check failed:', (err as Error).message);
  } finally {
    sessionCheckRunning = false;
  }
}

// ── Unread-meeting reminders ─────────────────────────────────────────────────
// Every 10 minutes, email owners about completed meetings they haven't opened
// after MEETING_REMINDER_HOURS (default 24h). One reminder per meeting; opening
// the meeting in the dashboard (viewed_at) excludes it permanently.
const REMINDER_CHECK_INTERVAL_MS = 10 * 60 * 1000;

async function checkUnviewedMeetingReminders(): Promise<void> {
  if (!config.meetingReminderHours || config.meetingReminderHours <= 0) return;
  if (!smtpConfigured()) return;
  if (Date.now() - lastReminderCheck < REMINDER_CHECK_INTERVAL_MS) return;
  lastReminderCheck = Date.now();

  try {
    const due = await getMeetingsNeedingReminder(config.meetingReminderHours);
    for (const m of due) {
      console.log(`[scheduler] Sending unread-meeting reminder for "${m.title ?? m.meetingCode}" → ${m.ownerEmail}`);
      await sendMeetingReminderEmail(m);
    }
  } catch (err) {
    console.error('[scheduler] Reminder check error:', (err as Error).message);
  }
}

async function checkCalendarEvents(): Promise<void> {
  try {
    const events = await getEventsToAutoJoin();
    for (const ev of events) {
      console.log(`[scheduler] Auto-joining calendar event "${ev.title}" for user ${ev.userId}`);
      try {
        // Pass ev.userId so the meeting is OWNED by the user — otherwise the
        // meeting row gets user_id=NULL and the user-scoped /api/bots/active and
        // /api/meetings lists filter it out (it never shows on Live Recording or
        // the Dashboard). botManager.launch returns the meeting CODE; resolve the
        // DB UUID before linking, since calendar_events.meeting_id is a UUID FK
        // (linking the code directly throws and the event never links).
        const meetingCode = await botManager.launch(ev.meetUrl, ev.userId, ev.title);
        const dbMeetingId = await getMeetingIdByCode(meetingCode, ev.userId);
        await linkMeeting(ev.eventId, dbMeetingId);
        console.log(`[scheduler] Launched bot for "${ev.title}" → ${meetingCode} (db ${dbMeetingId ?? 'pending'})`);
      } catch (err) {
        console.error(`[scheduler] Failed to auto-join "${ev.title}":`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error('[scheduler] Calendar check error:', (err as Error).message);
  }
}

const DAILY_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function dailyEmailSync(): Promise<void> {
  if (Date.now() - lastDailyEmailSync < DAILY_SYNC_INTERVAL_MS) return;
  lastDailyEmailSync = Date.now();

  try {
    const usersRes = await db.query('SELECT id FROM users WHERE refresh_token IS NOT NULL');
    for (const row of usersRes.rows) {
      try {
        console.log(`[scheduler] Daily email sync for user ${row.id}`);
        await syncEmails(row.id);
        await analyzeUnanalyzedThreads(row.id, 10);
        await detectFollowUps(row.id);
      } catch (err) {
        console.warn(`[scheduler] Email sync failed for user ${row.id}:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error('[scheduler] Daily email sync error:', (err as Error).message);
  }
}

async function checkScheduledMeetings(): Promise<void> {
  try {
    const due = await getDueScheduledMeetings();
    for (const s of due) {
      console.log(`[scheduler] Auto-launching scheduled "${s.title}" for user ${s.userId}`);
      try {
        const meetingCode = await botManager.launch(s.meetingUrl, s.userId, s.title);
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
