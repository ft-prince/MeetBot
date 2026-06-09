import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { URL } from 'url';
import { createSttClient, type SttClient } from './sttClient';
import { SpeakerCorrelator } from '../services/speakerCorrelator';
import type { IdentifiedSegment } from '../services/speakerCorrelator';
import {
  createMeeting,
  endMeeting,
  saveSegment,
  saveSummary,
  savePipelineResults,
  updateSpeakerName,
  logDomEvent,
  appendScreenShareEvent,
  getMeetingTranscript,
} from '../services/meetingService';
import { runPipeline } from '../services/aiPipelineService';

// One session per connected WebSocket (one per active meeting)
interface Session {
  meetingId: string;       // DB UUID
  meetingCode: string;     // e.g. "abc-defg-hij"
  panelClients: Set<WebSocket>;
  whisper: SttClient;
  correlator: SpeakerCorrelator;
  startedAt: number;
  isAudioSource: boolean;
  // Per-participant track transcription (replaces merged audio)
  trackWhispers: Map<string, SttClient>;  // trackId → STT client
  trackNames: Map<string, string>;            // trackId → participant name
  // Stable display label per unique (trackId, Deepgram-diarized speaker) pair.
  // Teams mixes all remote participants into one RTC track, so a single track
  // can carry several speakers; Deepgram's per-word diarization separates them.
  speakerLabels: Map<string, string>;         // `${trackId}:${diarizedLabel}` → "Speaker N"
  // Real name resolved for a diarized speaker, once confidently bound.
  speakerNames: Map<string, string>;          // `${trackId}:${diarizedLabel}` → participant name
  // Co-occurrence votes: how often each DOM active speaker was talking while a
  // given diarized speaker's segments finalised. Dominant name wins once locked.
  speakerVotes: Map<string, Map<string, number>>; // `${trackId}:${diarizedLabel}` → (name → count)
  // Live active speaker (Zoom mixed-stream path): set from DOM speaker_start
  // events and used to tag transcript segments, since a single mixed stream
  // can't be diarized reliably per participant.
  currentSpeaker: string | null;
  // Human participants observed in the roster (bot excluded). On a mixed stream
  // with no live active-speaker signal, a single known participant lets us
  // attribute all speech to them (the common 1:1 case).
  knownParticipants: Set<string>;
}

// Map from meetingCode → session (so panel can join same session)
const sessions = new Map<string, Session>();

// Map from individual WS → session it belongs to
const wsToSession = new Map<WebSocket, Session>();

export async function handleConnection(
  ws: WebSocket,
  req: IncomingMessage
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost`);
  const path = url.pathname;
  const meetingCode = url.searchParams.get('meetingId') || `meet-${Date.now()}`;

  // /audio  — from background.js (sends binary PCM + JSON control messages)
  // /panel  — from panel.js (receives transcript events, no audio)
  const isAudioSource = path === '/audio';
  const isPanelClient = path === '/panel' || path === '/';

  console.log(`[ingest] New connection: ${path}, meeting=${meetingCode}`);

  if (isAudioSource) {
    await handleAudioSource(ws, meetingCode);
  } else if (isPanelClient) {
    handlePanelClient(ws, meetingCode);
  } else {
    ws.close(1008, 'Unknown path');
  }
}

async function handleAudioSource(ws: WebSocket, meetingCode: string): Promise<void> {
  // Create or reuse session
  let session = sessions.get(meetingCode);

  if (!session) {
    const meeting = await createMeeting(meetingCode);
    const correlator = new SpeakerCorrelator();
    const panelClients = new Set<WebSocket>();

    const whisper = createSttClient(
      (segment, isFinal) => {
        const identified = correlator.correlate(segment);

        broadcastToPanel(panelClients, {
          type: isFinal ? 'transcript.final' : 'transcript.interim',
          segmentId: identified.segmentId,
          speakerLabel: identified.speakerLabel,
          speakerName: identified.speakerName,
          text: identified.text,
          startMs: identified.startMs,
          endMs: identified.endMs,
          confidence: identified.confidence,
        });

        if (isFinal) {
          saveSegment(meeting.id, identified).catch(console.error);
        }
      },
      (err) => console.error('[session] Whisper error:', err)
    );

    // When correlator resolves a label → name, update DB + notify panel
    correlator.onSpeakerIdentified = (label, name) => {
      updateSpeakerName(meeting.id, label, name).catch(console.error);

      broadcastToPanel(panelClients, {
        type: 'speaker.identified',
        label,
        name,
        meetingId: meeting.id,
      });
    };

    whisper.connect();

    session = {
      meetingId: meeting.id,
      meetingCode,
      panelClients,
      whisper,
      correlator,
      startedAt: Date.now(),
      isAudioSource: true,
      trackWhispers: new Map(),
      trackNames: new Map(),
      speakerLabels: new Map(),
      speakerNames: new Map(),
      speakerVotes: new Map(),
      currentSpeaker: null,
      knownParticipants: new Set(),
    };

    sessions.set(meetingCode, session);
    console.log(`[session] Created session for meeting ${meetingCode} (db: ${meeting.id})`);
  }

  wsToSession.set(ws, session);

  // Per-connection active track — Docker bot sends `track_select` before binary
  // to route PCM into a per-participant Deepgram client instead of the main one.
  // Null = legacy mode (binary goes to the shared mixed-stream whisper).
  let currentTrackId: string | null = null;

  // Binary frames = PCM audio chunks
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      if (currentTrackId) {
        forwardTrackAudio(meetingCode, data as Buffer, currentTrackId);
      } else {
        session!.whisper.sendAudio(data as Buffer);
      }
      return;
    }

    // Text frames = JSON control messages
    try {
      const msg = JSON.parse(data.toString());

      // Per-track routing protocol (Docker bot / future extension):
      //   track_select  — select which track subsequent binary frames belong to
      //   track_info    — bind a human name to a track id
      if (msg.type === 'track_select') {
        currentTrackId = (msg.trackId as string) || null;
        return;
      }
      if (msg.type === 'track_info') {
        setTrackName(meetingCode, msg.trackId as string, msg.name as string);
        return;
      }

      handleControlMessage(session!, msg);
    } catch {
      // not JSON, ignore
    }
  });

  ws.on('close', () => {
    wsToSession.delete(ws);
    const s = session!;
    s.whisper.disconnect();
    s.correlator.closeAllEvents(Date.now());
    endMeeting(s.meetingId).catch(console.error);
    sessions.delete(meetingCode);
    console.log(`[session] Session ended for ${meetingCode}`);
  });

  ws.on('error', (err) => {
    console.error(`[session] Audio source WS error:`, err.message);
  });
}

function handlePanelClient(ws: WebSocket, meetingCode: string): void {
  const session = sessions.get(meetingCode);

  if (session) {
    session.panelClients.add(ws);
    wsToSession.set(ws, session);

    // Send current known speakers so panel can render correct names immediately
    const known = session.correlator.getKnownSpeakers();
    for (const [label, name] of known.entries()) {
      ws.send(JSON.stringify({ type: 'speaker.identified', label, name }));
    }
  }

  ws.on('close', () => {
    session?.panelClients.delete(ws);
    wsToSession.delete(ws);
  });
}

function handleControlMessage(session: Session, msg: Record<string, unknown>): void {
  const type = msg.type as string;

  if (type === 'speaker_start') {
    const name = msg.name as string;
    const startMs = msg.startMs as number;
    // Live active speaker drives Zoom mixed-stream naming. Keep the last speaker
    // sticky (not cleared on speaker_end) so segments finalised just after speech
    // are still attributed correctly.
    session.currentSpeaker = name;
    session.correlator.domSpeakerStart(name, startMs);
    logDomEvent(session.meetingId, name, 'start', startMs).catch(console.error);
  }

  if (type === 'speaker_end') {
    const name = msg.name as string;
    const endMs = msg.endMs as number;
    session.correlator.domSpeakerEnd(name, endMs);
    logDomEvent(session.meetingId, name, 'end', endMs).catch(console.error);
  }

  if (type === 'session_end') {
    session.correlator.closeAllEvents(Date.now());
  }

  if (type === 'screenshare_start' || type === 'screenshare_end' || type === 'screenshare_update') {
    const presenter = (msg.presenter as string) || null;
    const ms = (msg.startMs as number) || (msg.endMs as number) || (msg.ms as number) || Date.now();
    console.log(`[session] ${type} ${presenter ? 'by ' + presenter : ''} at ${ms}`);
    appendScreenShareEvent(session.meetingId, type, presenter, ms).catch(console.error);
    // Notify any panel clients listening for live updates
    for (const client of session.panelClients) {
      try { client.send(JSON.stringify({ type, presenter, ms })); } catch {}
    }
  }

  // When only one participant is known, auto-assign all unresolved SPEAKER_X to them
  if (type === 'participant_known') {
    const name = msg.name as string;
    session.knownParticipants.add(name);
    session.correlator.registerParticipant(name);

    // Only auto-assign if there is exactly 1 known participant AND exactly 1 active track
    // (solo meeting scenario). With multiple participants, let pollParticipantNames handle it.
    if (session.trackWhispers.size === 1 && session.trackNames.size === 0) {
      const trackId = [...session.trackWhispers.keys()][0]
      session.trackNames.set(trackId, name)
      console.log(`[session] Solo auto-assigned "${name}" to track ${trackId.slice(0, 8)}`)
      broadcastToPanel(session.panelClients, {
        type: 'speaker.identified',
        label: trackId,
        name,
        meetingId: session.meetingId,
      })
    }
  }
}

function broadcastToPanel(
  clients: Set<WebSocket>,
  payload: Record<string, unknown>
): void {
  const json = JSON.stringify(payload);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  }
}

// Returns the DB UUID for an active session — used by Recall bot to save segments
export function getSessionMeetingId(meetingCode: string): string | null {
  return sessions.get(meetingCode)?.meetingId ?? null;
}

// Called by botManager to push events to all panel clients of a meeting
export function broadcastToMeeting(
  meetingCode: string,
  payload: Record<string, unknown>
): void {
  const session = sessions.get(meetingCode);
  if (session) broadcastToPanel(session.panelClients, payload);
}

// Create a session for a bot-initiated meeting (no WebSocket audio source)
export async function createBotSession(meetingCode: string, userId?: string): Promise<void> {
  if (sessions.has(meetingCode)) return;

  const meeting = await createMeeting(meetingCode, userId);
  const correlator = new SpeakerCorrelator();
  const panelClients = new Set<WebSocket>();

  const whisper = createSttClient(
    (segment, isFinal) => {
      const identified = correlator.correlate(segment);
      // Naming priority on a single mixed stream:
      //   1. live DOM active speaker (most precise, drives multi-party meetings)
      //   2. the sole known human participant — covers the common 1:1 case even
      //      when active-speaker DOM detection fails (e.g. Teams web)
      //   3. whatever the correlator resolved (may be null)
      // The Deepgram diarization label is unreliable on a combined stream, so we
      // override it whenever a real name is available.
      const sess = sessions.get(meetingCode);
      const live = sess?.currentSpeaker ?? null;
      const sole = sess && sess.knownParticipants.size === 1
        ? [...sess.knownParticipants][0]
        : null;
      const speakerName = live ?? sole ?? identified.speakerName;
      const speakerLabel = live ?? identified.speakerLabel;
      const tagged: IdentifiedSegment = { ...identified, speakerName, speakerLabel };

      broadcastToPanel(panelClients, {
        type: isFinal ? 'transcript.final' : 'transcript.interim',
        segmentId: tagged.segmentId,
        speakerLabel,
        speakerName,
        text: tagged.text,
        startMs: tagged.startMs,
        endMs: tagged.endMs,
        confidence: tagged.confidence,
      });
      if (isFinal) saveSegment(meeting.id, tagged).catch(console.error);
    },
    (err) => console.error('[session] Whisper error:', err)
  );

  correlator.onSpeakerIdentified = (label, name) => {
    updateSpeakerName(meeting.id, label, name).catch(console.error);
    broadcastToPanel(panelClients, { type: 'speaker.identified', label, name });
  };

  whisper.connect();

  sessions.set(meetingCode, {
    meetingId: meeting.id,
    meetingCode,
    panelClients,
    whisper,
    correlator,
    startedAt: Date.now(),
    isAudioSource: true,
    trackWhispers: new Map(),
    trackNames: new Map(),
    speakerLabels: new Map(),
    speakerNames: new Map(),
    speakerVotes: new Map(),
    currentSpeaker: null,
    knownParticipants: new Set(),
  });

  console.log(`[session] Bot session created for ${meetingCode} (db: ${meeting.id})`);
}

// Forward raw PCM audio from bot → whisper (legacy, kept for WS audio source)
export function forwardAudio(meetingCode: string, chunk: Buffer): void {
  sessions.get(meetingCode)?.whisper.sendAudio(chunk);
}

// Forward speaker DOM events from bot → correlator
export function forwardEvent(meetingCode: string, event: Record<string, unknown>): void {
  const session = sessions.get(meetingCode);
  if (!session) return;
  handleControlMessage(session, event);
}

// Number of co-occurrence votes a name needs before it is bound to a speaker.
const MIN_VOTES_TO_BIND = 3;

// Map a (track, Deepgram-diarized speaker) pair to a stable "Speaker N" label.
// One mixed track (e.g. Teams) can carry several diarized speakers, so labels
// are allocated per unique pair and reused for the life of the session.
function resolveSpeakerLabel(session: Session, key: string): string {
  const existing = session.speakerLabels.get(key);
  if (existing) return existing;
  const label = `Speaker ${session.speakerLabels.size + 1}`;
  session.speakerLabels.set(key, label);
  return label;
}

// Attribute a real participant name to a diarized speaker by majority
// co-occurrence with the live DOM active speaker. One vote is cast per finalised
// segment; once a name leads with enough support it is bound for the rest of the
// session, persisted to past segments, and pushed to the panel. Returns the
// resolved name, or null while still ambiguous.
function resolveSpeakerName(session: Session, key: string, label: string): string | null {
  const bound = session.speakerNames.get(key);
  if (bound) return bound;

  const voter = session.currentSpeaker;
  if (!voter) return null;

  const votes = session.speakerVotes.get(key) ?? new Map<string, number>();
  votes.set(voter, (votes.get(voter) ?? 0) + 1);
  session.speakerVotes.set(key, votes);

  let bestName: string | null = null;
  let bestCount = 0;
  for (const [name, count] of votes) {
    if (count > bestCount) { bestCount = count; bestName = name; }
  }
  if (!bestName || bestCount < MIN_VOTES_TO_BIND) return null;

  session.speakerNames.set(key, bestName);
  console.log(`[session] Bound ${label} → "${bestName}" (${bestCount} votes)`);
  broadcastToPanel(session.panelClients, {
    type: 'speaker.identified',
    label,
    name: bestName,
    meetingId: session.meetingId,
  });
  updateSpeakerName(session.meetingId, label, bestName).catch(console.error);
  return bestName;
}

// Per-participant audio: one whisper client per track
export function forwardTrackAudio(meetingCode: string, chunk: Buffer, trackId: string): void {
  const session = sessions.get(meetingCode);
  if (!session) return;

  if (!session.trackWhispers.has(trackId)) {
    const w = createSttClient(
      (segment, isFinal) => {
        const key = `${trackId}:${segment.speakerLabel}`;
        // Stable label so the panel can remap a speaker once their name is known.
        const label = resolveSpeakerLabel(session, key);
        // An explicit per-track name (true per-participant tracks) wins; otherwise
        // attribute via DOM active-speaker voting (mixed tracks like Teams).
        let name = session.trackNames.get(trackId) ?? session.speakerNames.get(key) ?? null;
        if (!name && isFinal) name = resolveSpeakerName(session, key, label);

        const identified = { ...segment, speakerName: name, speakerLabel: label };
        broadcastToPanel(session.panelClients, {
          type: isFinal ? 'transcript.final' : 'transcript.interim',
          segmentId:    identified.segmentId,
          speakerLabel: label,
          speakerName:  name,
          text:         identified.text,
          startMs:      identified.startMs,
          endMs:        identified.endMs,
          confidence:   identified.confidence,
        });
        if (isFinal) saveSegment(session.meetingId, identified).catch(console.error);
      },
      (err) => console.error(`[session] Track ${trackId.slice(0,8)} whisper error:`, err)
    );
    w.connect();
    session.trackWhispers.set(trackId, w);
    console.log(`[session] New whisper client for track ${trackId.slice(0, 8)}`);
  }

  session.trackWhispers.get(trackId)!.sendAudio(chunk);
}

// Associate a track ID with a participant name (resolved by audioInjector)
export function setTrackName(meetingCode: string, trackId: string, name: string): void {
  const session = sessions.get(meetingCode);
  if (!session) return;
  // Once a track has a confirmed name, don't let DOM re-scraping swap it
  if (session.trackNames.has(trackId)) return;
  session.trackNames.set(trackId, name);
  console.log(`[session] Track ${trackId.slice(0, 8)} → "${name}"`);
  broadcastToPanel(session.panelClients, {
    type: 'speaker.identified',
    label: trackId,
    name,
    meetingId: session.meetingId,
  });
}

// Shared teardown logic — disconnects whispers, ends DB meeting, notifies panel, clears session.
async function teardownSession(session: Session, meetingCode: string): Promise<void> {
  for (const [trackId, w] of session.trackWhispers) {
    try { w.disconnect(); } catch {}
    console.log(`[session] Disconnected whisper for track ${trackId.slice(0, 8)}`);
  }
  session.trackWhispers.clear();
  try { session.whisper.disconnect(); } catch {}
  session.correlator.closeAllEvents(Date.now());

  await endMeeting(session.meetingId).catch(console.error);
  broadcastToPanel(session.panelClients, { type: 'meeting.ended', meetingId: session.meetingId });
  sessions.delete(meetingCode);
}

// Called by botManager.stop() — tears down and generates AI summary
export async function endBotSession(meetingCode: string): Promise<void> {
  const session = sessions.get(meetingCode);
  if (!session) return;

  await teardownSession(session, meetingCode);
  console.log(`[session] Bot session ended for ${meetingCode}`);

  // Generate AI summary in background (non-blocking)
  generateSummaryInBackground(session.meetingId, meetingCode);
}

// Called by botManager.exit() — tears down WITHOUT generating summary (force-exit)
export async function endBotSessionNoSummary(meetingCode: string): Promise<void> {
  const session = sessions.get(meetingCode);
  if (!session) return;

  await teardownSession(session, meetingCode);
  console.log(`[session] Bot session force-exited for ${meetingCode} (no summary generated)`);
}

async function generateSummaryInBackground(meetingId: string, meetingCode: string): Promise<void> {
  try {
    console.log(`[pipeline] Running AI pipeline for ${meetingCode}…`);
    const segments = await getMeetingTranscript(meetingId);
    if (!segments || segments.length === 0) {
      console.log(`[pipeline] No segments found for ${meetingCode}, skipping`);
      return;
    }
    const result = await runPipeline(
      segments.map((s: Record<string, unknown>) => ({
        speakerName: s.speaker_name as string | null,
        speakerLabel: s.speaker_label as string,
        text: s.text as string,
        startMs: s.start_ms as number,
        endMs: s.end_ms as number,
      })),
      meetingCode,
    );
    // Persist whatever we got — even partial results
    await savePipelineResults(meetingId, result);
    console.log(`[pipeline] Done for ${meetingCode} (${Object.values(result.status).filter(s => s === 'ok').length} modules ok)`);
  } catch (err) {
    console.error(`[pipeline] Unhandled error for ${meetingCode}:`, (err as Error).message);
    // Even on a top-level crash, leave a row in the table — saveSummary fallback so UI shows something
    try {
      await saveSummary(meetingId, 'Analysis failed. The transcript is preserved.', [], '', []);
    } catch {}
  }
}