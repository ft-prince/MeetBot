import { spawn, type ChildProcess } from 'child_process';
import { MeetBot } from './meetBot';
import { ZoomBot } from './zoomBot';
import { TeamsBot } from './teamsBot';
import { RecallBot } from './recallBot';
import { VexaBot, type VexaPlatform } from './vexaBot';
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

// MeetBot, ZoomBot and TeamsBot share an identical start()/stop() callback
// contract, so the same in-house pipeline wiring drives all three.
type BrowserBot = MeetBot | ZoomBot | TeamsBot;

const activeBots = new Map<string, BrowserBot>();
const activeRecallBots = new Map<string, RecallBot>();
const activeVexaBots = new Map<string, VexaBot>();
const activeDockerBots = new Map<string, ChildProcess>();

// Resolve a meeting URL to Vexa's (platform, raw native id) pair. Returns null
// for platforms/URLs Vexa can't currently join from a bare URL (e.g. Teams,
// which needs the meeting id + passcode rather than the thread id).
function parseVexaMeeting(url: string): { platform: VexaPlatform; nativeId: string } | null {
  const meet = url.match(/\/([a-z]{3}-[a-z]{4}-[a-z]{3})/);
  if (meet) return { platform: 'google_meet', nativeId: meet[1] };
  if (isZoomUrl(url)) {
    const zoom = url.match(/\/(?:j|wc\/join)\/(\d+)/);
    if (zoom) return { platform: 'zoom', nativeId: zoom[1] };
  }
  return null;
}

export function extractMeetingId(url: string): string {
  const meetMatch = url.match(/\/([a-z]{3}-[a-z]{4}-[a-z]{3})/);
  if (meetMatch) return meetMatch[1];
  const zoomMatch = url.match(/\/(?:j|wc\/join)\/(\d+)/);
  if (zoomMatch) return `zoom-${zoomMatch[1]}`;
  if (isTeamsUrl(url)) {
    // meetup-join URLs embed a "19:meeting_<id>@thread.v2" conversation id.
    // The colon is usually URL-encoded as %3a, so match both forms.
    const teamsMatch = url.match(/19(?::|%3a)meeting_([A-Za-z0-9._-]+)/i);
    if (teamsMatch) return `teams-${teamsMatch[1].slice(0, 16)}`;
    // teams.live.com/meet/<digits>
    const liveMatch = url.match(/teams\.live\.com\/meet\/(\d+)/i);
    if (liveMatch) return `teams-${liveMatch[1]}`;
    return `teams-${Date.now()}`;
  }
  return `bot-${Date.now()}`;
}

function isZoomUrl(url: string): boolean {
  return /zoom\.us|zoomgov\.com/i.test(url);
}

export function isTeamsUrl(url: string): boolean {
  return /teams\.microsoft\.com|teams\.live\.com/i.test(url);
}

export const botManager = {
  async launch(meetingUrl: string, userId?: string): Promise<string> {
    const meetingId = extractMeetingId(meetingUrl);
    if (activeBots.has(meetingId) || activeRecallBots.has(meetingId) || activeVexaBots.has(meetingId)) {
      return meetingId;
    }

    // Master switch: route through alternative engines before in-house bots.
    if (config.botEngine === 'docker') {
      return launchDockerBot(meetingId, meetingUrl, userId);
    }

    if (config.botEngine === 'vexa') {
      const parsed = parseVexaMeeting(meetingUrl);
      if (parsed) return launchVexaBot(meetingId, parsed.platform, parsed.nativeId, userId);
      console.warn(`[botManager] Vexa engine can't parse ${meetingUrl}; falling back to in-house bot`);
    }

    const zoom = isZoomUrl(meetingUrl);
    const teams = isTeamsUrl(meetingUrl);

    // Zoom/Teams fall back to the Recall cloud bot only when explicitly opted in.
    if (zoom && config.zoomBotMode === 'recall') {
      return launchRecallBot(meetingId, meetingUrl, userId);
    }
    if (teams && config.teamsBotMode === 'recall') {
      return launchRecallBot(meetingId, meetingUrl, userId);
    }

    // In-house path: TeamsBot for Teams URLs, ZoomBot for Zoom, MeetBot for Meet.
    const bot: BrowserBot = teams ? new TeamsBot() : zoom ? new ZoomBot() : new MeetBot();
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
        // Synthetic mixed-stream ids (Zoom WASM / Teams web) go through the
        // correlator path, tagged with the live DOM active speaker. Per-track
        // ids (Meet, legacy Zoom/Teams RTC) get their own transcription stream.
        if (trackId === 'zoom-mixed' || trackId === 'teams-mixed') {
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
    if (activeDockerBots.has(meetingId)) {
      await stopDockerBot(meetingId);
      return;
    }
    if (activeRecallBots.has(meetingId)) {
      const bot = activeRecallBots.get(meetingId)!;
      activeRecallBots.delete(meetingId);
      await bot.stop();
      // endBotSession is called inside onEnded callback after transcript is fetched
      return;
    }
    if (activeVexaBots.has(meetingId)) {
      // VexaBot.stop() finalizes via its onEnded callback, which saves segments
      // and ends the session — same deferred-cleanup contract as RecallBot.
      await stopVexaBot(meetingId);
      return;
    }
    const bot = activeBots.get(meetingId);
    activeBots.delete(meetingId);
    await Promise.all([bot?.stop(), endBotSession(meetingId)]);
  },

  async exit(meetingId: string): Promise<void> {
    if (activeDockerBots.has(meetingId)) {
      await stopDockerBot(meetingId, { noSummary: true });
      return;
    }
    if (activeRecallBots.has(meetingId)) {
      const bot = activeRecallBots.get(meetingId)!;
      activeRecallBots.delete(meetingId);
      await bot.stop();
      await endBotSessionNoSummary(meetingId);
      return;
    }
    if (activeVexaBots.has(meetingId)) {
      await stopVexaBot(meetingId);
      return;
    }
    const bot = activeBots.get(meetingId);
    activeBots.delete(meetingId);
    await Promise.all([bot?.stop(), endBotSessionNoSummary(meetingId)]);
  },

  active(): string[] {
    return [
      ...activeBots.keys(),
      ...activeRecallBots.keys(),
      ...activeVexaBots.keys(),
      ...activeDockerBots.keys(),
    ];
  },
};

async function launchDockerBot(meetingId: string, meetingUrl: string, userId?: string): Promise<string> {
  await createBotSession(meetingId, userId);

  const backendWs = `${config.docker.backendWsBase}/audio?meetingId=${encodeURIComponent(meetingId)}`;

  const dockerArgs = [
    'run', '--rm',
    '--network', config.docker.networkMode,
    '-e', `MEETING_URL=${meetingUrl}`,
    '-e', `BACKEND_WS=${backendWs}`,
    '-e', 'DISPLAY_NAME=NoteAI Recorder',
    ...(config.docker.extraFlags ? config.docker.extraFlags.split(' ').filter(Boolean) : []),
    config.docker.image,
  ];

  console.log('[botManager] Spawning Docker bot:', 'docker', dockerArgs.join(' '));

  const proc = spawn('docker', dockerArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  activeDockerBots.set(meetingId, proc);

  proc.stdout?.on('data', (d: Buffer) => process.stdout.write(`[docker:${meetingId}] ${d}`));
  proc.stderr?.on('data', (d: Buffer) => process.stderr.write(`[docker:${meetingId}] ${d}`));

  proc.on('error', (err: Error) => {
    console.error('[botManager] Docker spawn error:', err);
    activeDockerBots.delete(meetingId);
    broadcastToMeeting(meetingId, { type: 'bot.error', meetingId, error: err.message });
    endBotSession(meetingId).catch(console.error);
  });

  proc.on('close', (code: number | null) => {
    console.log(`[botManager] Docker bot exited (code ${code}) for ${meetingId}`);
    activeDockerBots.delete(meetingId);
    broadcastToMeeting(meetingId, { type: 'meeting.ended', meetingId });
    endBotSession(meetingId).catch(console.error);
  });

  broadcastToMeeting(meetingId, { type: 'bot.joining', meetingId });
  return meetingId;
}

async function stopDockerBot(meetingId: string, opts?: { noSummary?: boolean }): Promise<void> {
  const proc = activeDockerBots.get(meetingId);
  if (!proc) return;
  activeDockerBots.delete(meetingId);
  proc.kill('SIGTERM');
  if (opts?.noSummary) {
    await endBotSessionNoSummary(meetingId);
  }
  // endBotSession is called from the 'close' event handler when the container exits
}

async function launchVexaBot(
  meetingId: string,
  platform: VexaPlatform,
  nativeId: string,
  userId?: string,
): Promise<string> {
  await createBotSession(meetingId, userId);

  const bot = new VexaBot(platform, nativeId);
  activeVexaBots.set(meetingId, bot);

  const callbacks = {
    onJoined: () => {
      broadcastToMeeting(meetingId, { type: 'bot.joined', meetingId });
      console.log('[botManager] Vexa bot joined', meetingId);
    },

    // Vexa segments carry stable ids and refine over time. We broadcast each as
    // transcript.final so it appears in the live list immediately; the frontend
    // upserts by segmentId, so later refinements update the row in place rather
    // than duplicating it.
    onSegment: (seg: IdentifiedSegment) => {
      broadcastToMeeting(meetingId, {
        type: 'transcript.final',
        segmentId: seg.segmentId,
        speakerLabel: seg.speakerLabel,
        speakerName: seg.speakerName,
        text: seg.text,
        startMs: seg.startMs,
        endMs: seg.endMs,
        confidence: seg.confidence,
      });
    },

    // At meeting end we persist the authoritative REST transcript to the DB only.
    // We do NOT re-broadcast: the live finals already populated the panel, and the
    // detail view reloads segments from the DB.
    onEnded: async (segments: IdentifiedSegment[]) => {
      activeVexaBots.delete(meetingId);

      const dbMeetingId = getSessionMeetingId(meetingId);
      if (dbMeetingId && segments.length > 0) {
        console.log(`[botManager] Saving ${segments.length} Vexa segments for ${meetingId}`);
        for (const seg of segments) {
          await saveSegment(dbMeetingId, seg).catch(err =>
            console.error('[botManager] saveSegment error:', err)
          );
        }
      }

      await endBotSession(meetingId);
    },

    onError: (err: Error) => {
      console.error('[botManager] Vexa bot error:', err);
      activeVexaBots.delete(meetingId);
      broadcastToMeeting(meetingId, { type: 'bot.error', meetingId, error: err.message });
      endBotSession(meetingId).catch(console.error);
    },
  };

  bot.start(callbacks).catch((err: Error) => {
    console.error('[botManager] Failed to start Vexa bot:', err);
    activeVexaBots.delete(meetingId);
    broadcastToMeeting(meetingId, { type: 'bot.error', meetingId, error: err.message });
    endBotSession(meetingId).catch(console.error);
  });

  return meetingId;
}

async function stopVexaBot(meetingId: string): Promise<void> {
  const bot = activeVexaBots.get(meetingId);
  if (!bot) return;
  // Keep the entry until onEnded fires so a duplicate stop is a no-op; VexaBot
  // re-invokes onEnded (which deletes it) after draining the final transcript.
  await bot.stop({
    onJoined: () => {},
    onSegment: () => {},
    onEnded: async (segments: IdentifiedSegment[]) => {
      activeVexaBots.delete(meetingId);
      const dbMeetingId = getSessionMeetingId(meetingId);
      if (dbMeetingId && segments.length > 0) {
        for (const seg of segments) {
          await saveSegment(dbMeetingId, seg).catch(err =>
            console.error('[botManager] saveSegment error:', err)
          );
        }
      }
      await endBotSession(meetingId);
    },
    onError: (err: Error) => console.error('[botManager] Vexa stop error:', err),
  });
}

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