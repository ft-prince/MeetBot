import { MeetBot } from './meetBot';
import { ZoomBot } from './zoomBot';
import { RecallBot } from './recallBot';
import { config } from '../config';
import {
  broadcastToMeeting,
  createBotSession,
  endBotSession,
  endBotSessionNoSummary,
  forwardAudio,
  forwardEvent,
  forwardTrackAudio,
  getSessionMeetingId,
  setTrackName,
} from '../ws/ingestHandler';
import { saveSegment } from '../services/meetingService';
import type { IdentifiedSegment } from '../services/speakerCorrelator';

// MeetBot and ZoomBot share an identical start()/stop() callback contract, so the
// same in-house pipeline wiring drives both.
type BrowserBot = MeetBot | ZoomBot;

const activeBots = new Map<string, BrowserBot>();
const activeRecallBots = new Map<string, RecallBot>();

function extractMeetingId(url: string): string {
  const meetMatch = url.match(/\/([a-z]{3}-[a-z]{4}-[a-z]{3})/);
  if (meetMatch) return meetMatch[1];
  const zoomMatch = url.match(/\/(?:j|wc\/join)\/(\d+)/);
  if (zoomMatch) return `zoom-${zoomMatch[1]}`;
  return `bot-${Date.now()}`;
}

function isZoomUrl(url: string): boolean {
  return /zoom\.us|zoomgov\.com/i.test(url);
}

export const botManager = {
  async launch(meetingUrl: string, userId?: string): Promise<string> {
    const meetingId = extractMeetingId(meetingUrl);
    if (activeBots.has(meetingId) || activeRecallBots.has(meetingId)) return meetingId;

    const zoom = isZoomUrl(meetingUrl);

    // Zoom falls back to the Recall cloud bot only when explicitly opted in.
    if (zoom && config.zoomBotMode === 'recall') {
      return launchRecallBot(meetingId, meetingUrl, userId);
    }

    // In-house path: ZoomBot for Zoom URLs, MeetBot for Google Meet.
    const bot: BrowserBot = zoom ? new ZoomBot() : new MeetBot();
    activeBots.set(meetingId, bot);

    await createBotSession(meetingId, userId);

    // Audio routing:
    //   • Google Meet: per-participant WebRTC tracks → forwardTrackAudio (one
    //     Deepgram per track, named via DOM scrape).
    //   • Zoom WASM client (us05, paid): one mixed Web Audio tap → forwardAudio
    //     (correlator path), tagged with the live active speaker. The injector
    //     signals this path by using the synthetic trackId 'zoom-mixed'.
    //   • Zoom legacy WebRTC (us04, free): per-participant RTC tracks just like
    //     Meet → forwardTrackAudio, names resolved via co-occurrence in the
    //     injector and delivered through onTrackInfo / setTrackName.
    bot.start({
      meetingUrl,
      displayName: 'NoteAI Recorder',

      onTrackAudio: (chunk, trackId) => {
        if (trackId === 'zoom-mixed') {
          forwardAudio(meetingId, chunk);
        } else {
          forwardTrackAudio(meetingId, chunk, trackId);
        }
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

  async stop(meetingId: string): Promise<void> {
    if (activeRecallBots.has(meetingId)) {
      const bot = activeRecallBots.get(meetingId)!;
      activeRecallBots.delete(meetingId);
      await bot.stop();
      // endBotSession is called inside onEnded callback after transcript is fetched
      return;
    }
    const bot = activeBots.get(meetingId);
    activeBots.delete(meetingId);
    await Promise.all([bot?.stop(), endBotSession(meetingId)]);
  },

  async exit(meetingId: string): Promise<void> {
    if (activeRecallBots.has(meetingId)) {
      const bot = activeRecallBots.get(meetingId)!;
      activeRecallBots.delete(meetingId);
      await bot.stop();
      await endBotSessionNoSummary(meetingId);
      return;
    }
    const bot = activeBots.get(meetingId);
    activeBots.delete(meetingId);
    await Promise.all([bot?.stop(), endBotSessionNoSummary(meetingId)]);
  },

  active(): string[] {
    return [...activeBots.keys(), ...activeRecallBots.keys()];
  },
};

async function launchRecallBot(meetingId: string, meetingUrl: string, userId?: string): Promise<string> {
  // createBotSession creates the DB meeting record and sets up the session so
  // panel WebSocket clients can connect and receive broadcast events.
  await createBotSession(meetingId, userId);

  const bot = new RecallBot();
  activeRecallBots.set(meetingId, bot);

  bot.start(meetingUrl, 'NoteAI', {
    onJoined: () => {
      broadcastToMeeting(meetingId, { type: 'bot.joined', meetingId });
      console.log('[botManager] Recall bot joined', meetingId);
    },

    onEnded: async (segments: IdentifiedSegment[]) => {
      activeRecallBots.delete(meetingId);

      const dbMeetingId = getSessionMeetingId(meetingId);
      if (dbMeetingId && segments.length > 0) {
        console.log(`[botManager] Saving ${segments.length} Recall segments for ${meetingId}`);
        for (const seg of segments) {
          await saveSegment(dbMeetingId, seg).catch(err =>
            console.error('[botManager] saveSegment error:', err)
          );
        }
      }

      await endBotSession(meetingId);
    },

    onError: (err: Error) => {
      console.error('[botManager] Recall bot error:', err);
      activeRecallBots.delete(meetingId);
      broadcastToMeeting(meetingId, { type: 'bot.error', meetingId, error: err.message });
      endBotSession(meetingId).catch(console.error);
    },
  }).catch((err: Error) => {
    console.error('[botManager] Failed to start Recall bot:', err);
    activeRecallBots.delete(meetingId);
  });

  return meetingId;
}