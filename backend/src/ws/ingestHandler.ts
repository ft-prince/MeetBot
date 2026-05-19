import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { URL } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { DeepgramClient as WhisperClient } from './deepgramClient';
import { SpeakerCorrelator, IdentifiedSegment } from '../services/speakerCorrelator';
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
  whisper?: WhisperClient;           // undefined for Recall sessions (no local Deepgram)
  correlator?: SpeakerCorrelator;    // undefined for Recall sessions (names come from Recall)
  startedAt: number;
  isAudioSource: boolean;
  isRecall: boolean;                 // true = Recall cloud bot, no local audio processing
  // Per-participant track transcription (replaces merged audio)
  trackWhispers: Map<string, WhisperClient>;  // trackId → WhisperClient
  trackNames: Map<string, string>;            // trackId → participant name
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

    const whisper = new WhisperClient(
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
      isRecall: false,
      trackWhispers: new Map(),
      trackNames: new Map(),
    };

    sessions.set(meetingCode, session);
    console.log(`[session] Created session for meeting ${meetingCode} (db: ${meeting.id})`);
  }

  wsToSession.set(ws, session);

  // Binary frames = PCM audio chunks
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      session!.whisper?.sendAudio(data as Buffer);
      return;
    }

    // Text frames = JSON control messages from content.js
    try {
      const msg = JSON.parse(data.toString());
      handleControlMessage(session!, msg);
    } catch {
      // not JSON, ignore
    }
  });

  ws.on('close', () => {
    wsToSession.delete(ws);
    const s = session!;
    s.whisper?.disconnect();
    s.correlator?.closeAllEvents(Date.now());
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
    const known = session.correlator?.getKnownSpeakers();
    if (known) {
      for (const [label, name] of known.entries()) {
        ws.send(JSON.stringify({ type: 'speaker.identified', label, name }));
      }
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
    session.correlator?.domSpeakerStart(name, startMs);
    logDomEvent(session.meetingId, name, 'start', startMs).catch(console.error);
  }

  if (type === 'speaker_end') {
    const name = msg.name as string;
    const endMs = msg.endMs as number;
    session.correlator?.domSpeakerEnd(name, endMs);
    logDomEvent(session.meetingId, name, 'end', endMs).catch(console.error);
  }

  if (type === 'session_end') {
    session.correlator?.closeAllEvents(Date.now());
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
    session.correlator?.registerParticipant(name);

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

  const whisper = new WhisperClient(
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
      if (isFinal) saveSegment(meeting.id, identified).catch(console.error);
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
    isRecall: false,
    trackWhispers: new Map(),
    trackNames: new Map(),
  });

  console.log(`[session] Bot session created for ${meetingCode} (db: ${meeting.id})`);
}

// Forward raw PCM audio from bot → whisper (legacy, kept for WS audio source)
export function forwardAudio(meetingCode: string, chunk: Buffer): void {
  sessions.get(meetingCode)?.whisper?.sendAudio(chunk);
}

// Forward speaker DOM events from bot → correlator
export function forwardEvent(meetingCode: string, event: Record<string, unknown>): void {
  const session = sessions.get(meetingCode);
  if (!session) return;
  handleControlMessage(session, event);
}

// Per-participant audio: one whisper client per track
export function forwardTrackAudio(meetingCode: string, chunk: Buffer, trackId: string): void {
  const session = sessions.get(meetingCode);
  if (!session) return;

  if (!session.trackWhispers.has(trackId)) {
    const isMixed = trackId.startsWith('mixed');
    const speakerName = () => session.trackNames.get(trackId) ?? null;

    const w = new WhisperClient(
      (segment, isFinal) => {
        const wallOffset = isMixed ? (w.streamStartWallMs ?? 0) : 0;
        const identified = isMixed
          ? session.correlator?.correlate(segment, wallOffset) ?? { ...segment, speakerName: null }
          : { ...segment, speakerName: speakerName(), speakerLabel: trackId };

        broadcastToPanel(session.panelClients, {
          type: isFinal ? 'transcript.final' : 'transcript.interim',
          segmentId:    identified.segmentId,
          speakerLabel: identified.speakerLabel,
          speakerName:  identified.speakerName,
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
  try { session.whisper?.disconnect(); } catch {}
  session.correlator?.closeAllEvents(Date.now());

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

// ── Recall.ai session helpers ─────────────────────────────────────────────────

import {
  waitForTranscript,
  downloadTranscript,
  RecallProcessedSegment,
} from '../services/recallService';

function recallTsToMs(ts: unknown): number {
  if (typeof ts === 'number') return Math.round(ts * 1000);
  if (ts && typeof ts === 'object' && 'relative' in ts) {
    return Math.round((ts as { relative: number }).relative * 1000);
  }
  return 0;
}

/**
 * End a Recall session: fetch the final transcript from Recall, save all
 * segments to DB, mark the meeting as ended, then trigger AI summary.
 * This is the no-webhook path — works without any tunnel.
 */
export async function endRecallSession(meetingCode: string, botId: string | null): Promise<void> {
  const session = sessions.get(meetingCode);
  if (!session) {
    console.warn(`[recall] endRecallSession: no session for ${meetingCode}`);
    return;
  }

  const meetingId = session.meetingId;

  // Notify panel + cleanup session early so the UI moves on
  broadcastToPanel(session.panelClients, { type: 'meeting.ended', meetingId });
  sessions.delete(meetingCode);

  // The rest runs in background — user can refresh homepage when ready
  if (!botId) {
    console.warn('[recall] No botId provided — cannot fetch transcript');
    await endMeeting(meetingId).catch(console.error);
    return;
  }

  try {
    console.log(`[recall] Waiting for transcript for botId=${botId}...`);
    const url = await waitForTranscript(botId);
    if (!url) {
      console.warn(`[recall] Transcript never became ready for botId=${botId}`);
      await endMeeting(meetingId).catch(console.error);
      return;
    }

    console.log(`[recall] Downloading transcript JSON...`);
    const recallSegments: RecallProcessedSegment[] = await downloadTranscript(url);
    console.log(`[recall] Got ${recallSegments.length} segments from Recall`);

    for (const seg of recallSegments) {
      const words = seg.words ?? [];
      const text = words.map(w => w.text).join(' ').trim();
      if (!text) continue;

      const identified: IdentifiedSegment = {
        segmentId: uuidv4(),
        speakerLabel: `recall-${seg.participant?.id ?? 0}`,
        speakerName: seg.participant?.name || null,
        text,
        startMs: recallTsToMs(words[0]?.start_timestamp),
        endMs: recallTsToMs(words[words.length - 1]?.end_timestamp),
      };

      await saveSegment(meetingId, identified).catch(console.error);
    }

    console.log(`[recall] Saved ${recallSegments.length} segments to DB`);

    // Mark meeting as ended in DB
    await endMeeting(meetingId).catch(console.error);

    // Now run the AI pipeline (summary, action items, etc.)
    await generateSummaryInBackground(meetingId, meetingCode);
  } catch (err) {
    console.error('[recall] endRecallSession failed:', (err as Error).message);
    await endMeeting(meetingId).catch(console.error);
  }
}


/**
 * Create a lightweight session for a Recall cloud bot.
 * No WhisperClient or SpeakerCorrelator — Recall handles transcription in the cloud.
 * Transcript segments arrive via the webhook and are forwarded here.
 */
export async function createRecallSession(meetingCode: string, userId?: string): Promise<void> {
  if (sessions.has(meetingCode)) return;

  const meeting = await createMeeting(meetingCode, userId);
  const panelClients = new Set<WebSocket>();

  sessions.set(meetingCode, {
    meetingId: meeting.id,
    meetingCode,
    panelClients,
    startedAt: Date.now(),
    isAudioSource: false,
    isRecall: true,
    trackWhispers: new Map(),
    trackNames: new Map(),
    // whisper and correlator intentionally omitted — Recall handles transcription
  });

  console.log(`[session] Recall session created for ${meetingCode} (db: ${meeting.id})`);
}

export interface RecallSegmentPayload {
  speakerName: string | null;
  speakerLabel: string;
  text: string;
  startMs: number;
  endMs: number;
  isFinal: boolean;
}

/**
 * Called by the Recall webhook handler with each incoming transcript chunk.
 * Broadcasts to panel clients and persists final segments to the DB.
 */
export function forwardRecallSegment(meetingCode: string, seg: RecallSegmentPayload): void {
  const session = sessions.get(meetingCode);
  if (!session) {
    console.warn(`[recall] forwardRecallSegment: no session for ${meetingCode}`);
    return;
  }

  const identified: IdentifiedSegment = {
    segmentId: uuidv4(),
    speakerLabel: seg.speakerLabel,
    speakerName: seg.speakerName,
    text: seg.text,
    startMs: seg.startMs,
    endMs: seg.endMs,
  };

  broadcastToPanel(session.panelClients, {
    type: seg.isFinal ? 'transcript.final' : 'transcript.interim',
    segmentId: identified.segmentId,
    speakerLabel: identified.speakerLabel,
    speakerName: identified.speakerName,
    text: identified.text,
    startMs: identified.startMs,
    endMs: identified.endMs,
  });

  if (seg.isFinal) {
    saveSegment(session.meetingId, identified).catch(console.error);
    // If we got a speaker name, persist it so the transcript view shows it
    if (seg.speakerName) {
      updateSpeakerName(session.meetingId, seg.speakerLabel, seg.speakerName).catch(console.error);
      broadcastToPanel(session.panelClients, {
        type: 'speaker.identified',
        label: seg.speakerLabel,
        name: seg.speakerName,
        meetingId: session.meetingId,
      });
    }
  }
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