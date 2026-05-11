import { MeetBot } from './meetBot';
import {
  broadcastToMeeting,
  createBotSession,
  endBotSession,
  endBotSessionNoSummary,
  forwardEvent,
  forwardTrackAudio,
  setTrackName,
} from '../ws/ingestHandler';

const activeBots = new Map<string, MeetBot>();

function extractMeetingId(url: string): string {
  const m = url.match(/\/([a-z]{3}-[a-z]{4}-[a-z]{3})/);
  return m ? m[1] : `bot-${Date.now()}`;
}

export const botManager = {
  async launch(meetingUrl: string, userId?: string): Promise<string> {
    const meetingId = extractMeetingId(meetingUrl);
    if (activeBots.has(meetingId)) return meetingId;

    const bot = new MeetBot();
    activeBots.set(meetingId, bot);

    // Create the ingest session before bot joins so it's ready to receive audio
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
        console.log('[botManager] Bot joined', meetingId);
      },

      onEnded: () => {
        activeBots.delete(meetingId);
        broadcastToMeeting(meetingId, { type: 'meeting.ended', meetingId });
        // endBotSession generates summary + saves everything
        endBotSession(meetingId).catch(console.error);
      },

      onError: (err) => {
        console.error('[botManager] Bot error:', err);
        activeBots.delete(meetingId);
        broadcastToMeeting(meetingId, { type: 'bot.error', meetingId, error: err.message });
        endBotSession(meetingId).catch(console.error);
      },
    }).catch((err: Error) => {
      if (!err.message?.includes('closed') && !err.message?.includes('Target')) {
        console.error('[botManager] Failed to start bot:', err);
      }
      activeBots.delete(meetingId);
    });

    return meetingId;
  },

  // Graceful stop — leaves the meeting cleanly and generates AI summary.
  async stop(meetingId: string): Promise<void> {
    const bot = activeBots.get(meetingId);
    activeBots.delete(meetingId);
    await Promise.all([bot?.stop(), endBotSession(meetingId)]);
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
