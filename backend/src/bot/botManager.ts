import { MeetBot } from './meetBot';
import { ZoomBot } from './zoomBot';
import { RecallBot } from './recallBot';
import {
  broadcastToMeeting,
  createBotSession,
  createRecallSession,
  endBotSession,
  endBotSessionNoSummary,
  endRecallSession,
  forwardEvent,
  forwardTrackAudio,
  setTrackName,
} from '../ws/ingestHandler';

const activeBots = new Map<string, MeetBot | ZoomBot | RecallBot>();

function isZoomUrl(url: string): boolean {
  return /zoom\.us\//i.test(url);
}

function isTeamsUrl(url: string): boolean {
  // Covers teams.microsoft.com, teams.live.com, and *.teams.microsoft.us (gov)
  return /teams\.(microsoft|live)\.(com|us)\//i.test(url);
}

function isMeetUrl(url: string): boolean {
  return /meet\.google\.com\//i.test(url);
}

// All meeting platforms now go through Recall (managed cloud bot).
// The self-hosted MeetBot is kept in the codebase as a fallback but is not used.
function isRecallPlatform(url: string): boolean {
  return isZoomUrl(url) || isTeamsUrl(url) || isMeetUrl(url);
}

function extractMeetingId(url: string): string {
  // Zoom: zoom.us/j/1234567890 or zoom.us/wc/1234567890/join
  const zoomMatch = url.match(/\/(?:j|wc)\/(\d{9,11})/);
  if (zoomMatch) return `zoom-${zoomMatch[1]}`;

  // Teams meetup-join: …/meetup-join/19%3ameeting_<id>%40thread.v2/…
  const teamsMeetupMatch = url.match(/meetup-join\/([^/?]+)/i);
  if (teamsMeetupMatch) {
    // URL-decoded portion has %3a/%40 — strip non-alphanumerics for a stable code
    const safe = decodeURIComponent(teamsMeetupMatch[1]).replace(/[^a-z0-9]/gi, '').slice(0, 32);
    return `teams-${safe}`;
  }
  // Teams Live shareable link: teams.live.com/meet/<digits>
  const teamsLiveMatch = url.match(/teams\.live\.com\/meet\/(\d+)/i);
  if (teamsLiveMatch) return `teams-${teamsLiveMatch[1]}`;

  // Google Meet: meet.google.com/xxx-xxxx-xxx
  const meetMatch = url.match(/\/([a-z]{3}-[a-z]{4}-[a-z]{3})/);
  return meetMatch ? meetMatch[1] : `bot-${Date.now()}`;
}

export const botManager = {
  async launch(meetingUrl: string, userId?: string): Promise<string> {
    const meetingId = extractMeetingId(meetingUrl);
    if (activeBots.has(meetingId)) return meetingId;

    if (isRecallPlatform(meetingUrl)) {
      // ── Google Meet / Zoom / Teams → Recall cloud bot ────────────────────
      // Recall handles audio capture, speaker attribution, and transcription
      // in the cloud. Transcript is fetched after the meeting ends via
      // endRecallSession → saved to DB → AI pipeline runs.
      const bot = new RecallBot();
      activeBots.set(meetingId, bot);

      await createRecallSession(meetingId, userId);

      bot.start({
        meetingUrl,
        meetingCode: meetingId,
        displayName: 'NoteAI Recorder',

        onJoined: () => {
          broadcastToMeeting(meetingId, { type: 'bot.joined', meetingId });
          console.log('[botManager] Recall bot joined', meetingId);
        },

        onEnded: () => {
          activeBots.delete(meetingId);
          broadcastToMeeting(meetingId, { type: 'meeting.ended', meetingId });
          // Recall path: fetch final transcript from cloud → save → summary
          endRecallSession(meetingId, bot.lastBotId).catch(console.error);
        },

        onError: (err) => {
          console.error('[botManager] Recall bot error:', err);
          activeBots.delete(meetingId);
          broadcastToMeeting(meetingId, { type: 'bot.error', meetingId, error: err.message });
          endRecallSession(meetingId, bot.lastBotId).catch(console.error);
        },
      }).catch((err: Error) => {
        console.error('[botManager] Failed to start Recall bot:', err);
        activeBots.delete(meetingId);
      });
    } else {
      // ── Google Meet → self-hosted Playwright bot ─────────────────────────
      const bot = new MeetBot();
      activeBots.set(meetingId, bot);

      await createBotSession(meetingId, userId);

      bot.start({
        meetingUrl,
        displayName: 'NoteAI Recorder',

        onTrackAudio: (chunk, trackId) => {
          forwardTrackAudio(meetingId, chunk, trackId);
        },

        onTrackInfo: (trackId, name) => {
          setTrackName(meetingId, trackId, name);
        },

        onSpeakerEvent: (event) => {
          forwardEvent(meetingId, event);
        },

        onJoined: () => {
          broadcastToMeeting(meetingId, { type: 'bot.joined', meetingId });
          console.log('[botManager] Meet bot joined', meetingId);
        },

        onEnded: () => {
          activeBots.delete(meetingId);
          broadcastToMeeting(meetingId, { type: 'meeting.ended', meetingId });
          endBotSession(meetingId).catch(console.error);
        },

        onError: (err) => {
          console.error('[botManager] Meet bot error:', err);
          activeBots.delete(meetingId);
          broadcastToMeeting(meetingId, { type: 'bot.error', meetingId, error: err.message });
          endBotSession(meetingId).catch(console.error);
        },
      }).catch((err: Error) => {
        if (!err.message?.includes('closed') && !err.message?.includes('Target')) {
          console.error('[botManager] Failed to start Meet bot:', err);
        }
        activeBots.delete(meetingId);
      });
    }

    return meetingId;
  },

  // Graceful stop — leaves the meeting cleanly and generates AI summary.
  async stop(meetingId: string): Promise<void> {
    const bot = activeBots.get(meetingId);
    activeBots.delete(meetingId);

    if (bot instanceof RecallBot) {
      // Capture botId BEFORE stop() nulls it, so we can fetch the final transcript
      const recallBotId = bot.lastBotId;
      await bot.stop();
      await endRecallSession(meetingId, recallBotId);
    } else {
      await Promise.all([bot?.stop(), endBotSession(meetingId)]);
    }
  },

  // Force-exit — kills the browser immediately, no summary generated.
  async exit(meetingId: string): Promise<void> {
    const bot = activeBots.get(meetingId);
    activeBots.delete(meetingId);
    await Promise.all([bot?.stop(), endBotSessionNoSummary(meetingId)]);
  },

  active(): string[] {
    return [...activeBots.keys()];
  },
};