import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { URL } from 'url';
import * as cookie from 'cookie';
import * as cookieSignature from 'cookie-signature';
import { config } from '../config';
import { db } from '../db/client';
import { createSttClient, type SttClient } from './sttClient';
import { SpeakerCorrelator } from '../services/speakerCorrelator';
import type { IdentifiedSegment } from '../services/speakerCorrelator';
import {
  createMeeting,
  endMeeting,
  saveSegment,
  saveSegmentsBulk,
  saveSummary,
  savePipelineResults,
  updateSpeakerName,
  rebindSpeakerName,
  logDomEvent,
  appendScreenShareEvent,
  getMeetingTranscript,
} from '../services/meetingService';
import { runPipeline } from '../services/aiPipelineService';
import { diag } from '../services/diag';

// Per-track audio-level accumulator for live diagnostics. Tells us whether the
// bot is forwarding REAL audio (audible RMS) or silence (the classic "remote
// track is all zeros" failure) when a real meeting produces no transcripts.
const _diagRms = new Map<string, { sum: number; n: number; last: number; chunks: number;
  firstSeen: number; everAudible: boolean; warned: boolean }>();
function diagAudio(trackId: string, chunk: Buffer): void {
  // Read as Int16 via DataView so ANY byteOffset works. A plain
  // `new Int16Array(chunk.buffer, chunk.byteOffset, …)` throws
  // "start offset should be a multiple of 2" whenever Node's Buffer pool hands
  // back an odd byteOffset — an unhandled RangeError here crashes the whole
  // backend mid-meeting (it runs on every audio chunk).
  const dv = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  const n = Math.floor(chunk.byteLength / 2);
  let s = 0;
  for (let i = 0; i < n; i++) { const v = dv.getInt16(i * 2, true) / 32768; s += v * v; }
  const now = Date.now();
  const a = _diagRms.get(trackId) ?? { sum: 0, n: 0, last: 0, chunks: 0, firstSeen: now, everAudible: false, warned: false };
  a.sum += s; a.n += n; a.chunks += 1;
  if (now - a.last > 3000) {
    const rms = Math.sqrt(a.sum / Math.max(a.n, 1));
    const audible = rms >= 0.005;
    if (audible) a.everAudible = true;
    diag(`audio track ${trackId.slice(0, 8)}: ${a.chunks} chunks, RMS=${rms.toFixed(5)} ` +
      `${audible ? 'AUDIBLE' : 'SILENT(no transcripts expected)'}`);
    // A track that has carried only silence for 25s+ since it first appeared is
    // the "bot is fed zeros" failure. The most common real cause: the bot's
    // Google account is ALSO a human participant's account — Meet never sends a
    // participant their own audio (self-audio suppression), so every track is a
    // perfect 0.00000. Surface it once, actionably, instead of silently logging.
    if (!a.everAudible && !a.warned && now - a.firstSeen > 25_000) {
      a.warned = true;
      diag(`⚠ track ${trackId.slice(0, 8)} SILENT for ${Math.round((now - a.firstSeen) / 1000)}s — bot is receiving no audio. ` +
        `Most likely the bot's Google account is the SAME as a speaking participant's ` +
        `(Meet suppresses self-audio → all-zero tracks). Use a DEDICATED bot account that is not in the meeting as a human.`);
    }
    a.sum = 0; a.n = 0; a.last = now; a.chunks = 0;
  }
  _diagRms.set(trackId, a);
}

// One session per connected WebSocket (one per active meeting)
interface Session {
  meetingId: string;       // DB UUID
  meetingCode: string;     // e.g. "abc-defg-hij"
  // Owner of this meeting (the user who launched the bot). Panel subscribers must
  // match this id, otherwise a different logged-in user could receive the live
  // transcript of a meeting that isn't theirs. Null only for legacy /audio
  // sessions with no known owner.
  ownerUserId: string | null;
  panelClients: Set<WebSocket>;
  // Every finalized segment broadcast this session, kept in memory so we can
  // re-persist the whole transcript at meeting end even if individual live DB
  // writes failed transiently. Guarantees "the transcript is always saved".
  transcriptBuffer: IdentifiedSegment[];
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

// ── WebSocket authentication ─────────────────────────────────────────────────
// Resolve the authenticated user id from the express-session cookie carried on
// the WS upgrade request. The cookie is `connect.sid = s:<sid>.<sig>`, signed
// with config.sessionSecret; we unsign it and look the session row up in the
// same Postgres `session` table connect-pg-simple writes to. Returns null when
// the request is unauthenticated or the session is missing/expired.
async function getUserIdFromRequest(req: IncomingMessage): Promise<string | null> {
  try {
    const header = req.headers.cookie;
    if (!header) return null;
    const raw = cookie.parse(header)['connect.sid'];
    if (!raw || !raw.startsWith('s:')) return null;
    const sid = cookieSignature.unsign(raw.slice(2), config.sessionSecret);
    if (!sid) return null; // bad signature → forged/garbage cookie
    const result = await db.query(
      'SELECT sess FROM session WHERE sid = $1 AND expire > now()',
      [sid],
    );
    const sess = result.rows[0]?.sess;
    if (!sess) return null;
    const parsed = typeof sess === 'string' ? JSON.parse(sess) : sess;
    return (parsed?.userId as string) ?? null;
  } catch (err) {
    console.error('[ingest] getUserIdFromRequest error:', (err as Error).message);
    return null;
  }
}

// Verify a user owns the meeting identified by a meeting code. Used when a panel
// client connects before the in-memory session exists (or after it's gone) so we
// can authorize purely from the DB. Returns true only for the owner; a meeting
// row with a NULL user_id is treated as owner-less (legacy) and allowed for any
// authenticated user.
async function userOwnsMeetingCode(meetingCode: string, userId: string): Promise<boolean> {
  try {
    const r = await db.query(
      `SELECT user_id FROM meetings WHERE meeting_code = $1
       ORDER BY started_at DESC LIMIT 1`,
      [meetingCode],
    );
    if (!r.rows[0]) return false;
    const owner = r.rows[0].user_id as string | null;
    return owner == null || owner === userId;
  } catch {
    return false;
  }
}

// ── Persistence with a safety net ────────────────────────────────────────────
// Persist a finalized segment immediately AND keep it in the session buffer so
// teardown can re-flush anything that failed to write live. All failures are
// logged via diag() (→ bot-diag.log) so a silent DB problem is visible even on
// an elevated, console-invisible backend — the original cause of "live
// transcription works but nothing is saved".
function persistSegmentTo(
  meetingId: string,
  meetingCode: string,
  buffer: IdentifiedSegment[],
  segment: IdentifiedSegment,
): void {
  buffer.push(segment);
  saveSegment(meetingId, segment).catch(err => {
    diag(`⚠ saveSegment FAILED for ${meetingCode} seg=${segment.segmentId}: ${(err as Error).message} ` +
      `(buffered — will retry at meeting end)`);
  });
}

function persistSegment(session: Session, segment: IdentifiedSegment): void {
  persistSegmentTo(session.meetingId, session.meetingCode, session.transcriptBuffer, segment);
}

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
    await handlePanelClient(ws, meetingCode, req);
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
    const transcriptBuffer: IdentifiedSegment[] = [];

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
          persistSegmentTo(meeting.id, meetingCode, transcriptBuffer, identified);
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
      // /audio sessions created without a prior bot launch have no known owner.
      // (Bot-launched meetings always go through createBotSession, which sets it.)
      ownerUserId: null,
      panelClients,
      transcriptBuffer,
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
    // Full teardown (disconnect track whispers, flush buffered transcript to DB,
    // end the meeting) PLUS AI summary generation — same guarantees as the
    // bot-initiated path. endBotSession is idempotent: if the bot's own cleanup
    // (e.g. docker proc 'close') already tore the session down, this returns
    // early without double-processing.
    endBotSession(meetingCode).catch(err =>
      diag(`endBotSession error for ${meetingCode}: ${(err as Error).message}`));
    console.log(`[session] Session ended for ${meetingCode}`);
  });

  ws.on('error', (err) => {
    console.error(`[session] Audio source WS error:`, err.message);
  });
}

// WebSocket close codes for authn/authz failures (4000-4999 = application range).
const WS_UNAUTHENTICATED = 4401;
const WS_FORBIDDEN = 4403;

async function handlePanelClient(
  ws: WebSocket,
  meetingCode: string,
  req: IncomingMessage,
): Promise<void> {
  // ── Authenticate ──────────────────────────────────────────────────────────
  // A panel client streams a meeting's live transcript, so it MUST be tied to a
  // logged-in user. Without this, any browser could subscribe to any meeting's
  // transcript by guessing the code (the cross-user privacy leak).
  const userId = await getUserIdFromRequest(req);
  if (!userId) {
    console.warn(`[ingest] Panel rejected (unauthenticated) for ${meetingCode}`);
    ws.close(WS_UNAUTHENTICATED, 'Not authenticated');
    return;
  }

  const session = sessions.get(meetingCode);

  // ── Authorize ─────────────────────────────────────────────────────────────
  // The connecting user must own the meeting. Prefer the in-memory owner; fall
  // back to a DB ownership check when the session isn't live yet (or already
  // ended). Owner-less legacy meetings (NULL user_id) are allowed.
  const authorized = session
    ? (session.ownerUserId == null || session.ownerUserId === userId)
    : await userOwnsMeetingCode(meetingCode, userId);

  if (!authorized) {
    console.warn(`[ingest] Panel rejected (forbidden) user=${userId.slice(0, 8)} meeting=${meetingCode}`);
    ws.close(WS_FORBIDDEN, 'Forbidden');
    return;
  }

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
    // Screen-share pseudo-tiles ("X's presentation", "Y's screen") must never
    // become the active speaker — that's how starting a share used to corrupt
    // speaker attribution.
    if (isPseudoParticipantName(name)) return;
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
    if (isPseudoParticipantName(name)) return;
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
export async function createBotSession(meetingCode: string, userId?: string, title?: string): Promise<void> {
  if (sessions.has(meetingCode)) return;

  const meeting = await createMeeting(meetingCode, userId, title);
  const correlator = new SpeakerCorrelator();
  const panelClients = new Set<WebSocket>();
  const transcriptBuffer: IdentifiedSegment[] = [];

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
      if (isFinal) persistSegmentTo(meeting.id, meetingCode, transcriptBuffer, tagged);
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
    ownerUserId: userId ?? null,
    panelClients,
    transcriptBuffer,
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
// A name must lead the runner-up by this many votes before binding. Prevents a
// 3-2 photo finish (typical when two people talk over each other) from locking
// the wrong name in for the rest of the meeting.
const MIN_VOTE_MARGIN = 2;

// Pseudo-participants that appear in the DOM when someone shares their screen
// ("X's presentation" on Meet, "X's screen" on Zoom, generic "Presentation"
// tiles). These must NEVER become speaker names or roster participants —
// otherwise starting a screen share renames the speaker mid-meeting.
const PSEUDO_PARTICIPANT_RE = /(presentation|is presenting|presenting now|'s screen|screen share|screenshar|shared screen|\bscreen\b\s*$)/i;
export function isPseudoParticipantName(name: string | null | undefined): boolean {
  if (!name) return true;
  return PSEUDO_PARTICIPANT_RE.test(name.trim());
}

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
  if (!voter || isPseudoParticipantName(voter)) return null;

  const votes = session.speakerVotes.get(key) ?? new Map<string, number>();
  votes.set(voter, (votes.get(voter) ?? 0) + 1);
  session.speakerVotes.set(key, votes);

  let bestName: string | null = null;
  let bestCount = 0;
  let runnerUp = 0;
  for (const [name, count] of votes) {
    if (count > bestCount) { runnerUp = bestCount; bestCount = count; bestName = name; }
    else if (count > runnerUp) { runnerUp = count; }
  }
  // Bind only with clear support AND a clear lead — a near-tie (people talking
  // over each other) must not lock the wrong name in permanently.
  if (!bestName || bestCount < MIN_VOTES_TO_BIND || bestCount - runnerUp < MIN_VOTE_MARGIN) return null;

  session.speakerNames.set(key, bestName);
  console.log(`[session] Bound ${label} → "${bestName}" (${bestCount} votes, runner-up ${runnerUp})`);
  broadcastToPanel(session.panelClients, {
    type: 'speaker.identified',
    label,
    name: bestName,
    meetingId: session.meetingId,
  });
  // Retroactively correct EVERY earlier segment for this label — including ones
  // provisionally tagged with a different (wrong) name — in the DB and in the
  // in-memory buffer that gets flushed at meeting end. This is what keeps one
  // person from carrying two names in the final transcript.
  rebindSpeakerName(session.meetingId, label, bestName).catch(console.error);
  for (const seg of session.transcriptBuffer) {
    if (seg.speakerLabel === label) seg.speakerName = bestName;
  }
  return bestName;
}

// The current leader of the co-occurrence vote for a key — used as the
// PROVISIONAL display name before binding. Much more stable than tagging each
// segment with the momentary DOM active speaker (which flips names segment to
// segment when detection lags).
function voteLeader(session: Session, key: string): string | null {
  const votes = session.speakerVotes.get(key);
  if (!votes) return null;
  let best: string | null = null;
  let bestCount = 0;
  for (const [name, count] of votes) {
    if (count > bestCount) { bestCount = count; best = name; }
  }
  return best;
}

// Per-participant audio: one whisper client per track
export function forwardTrackAudio(meetingCode: string, chunk: Buffer, trackId: string): void {
  const session = sessions.get(meetingCode);
  if (!session) { diag(`forwardTrackAudio: NO SESSION for ${meetingCode} (track ${trackId.slice(0,8)})`); return; }

  diagAudio(trackId, chunk);

  if (!session.trackWhispers.has(trackId)) {
    const w = createSttClient(
      (segment, isFinal) => {
        const key = `${trackId}:${segment.speakerLabel}`;
        // Stable label so the panel can remap a speaker once their name is known.
        const label = resolveSpeakerLabel(session, key);
        // Name resolution, best signal first:
        //   1. explicit per-track binding (true per-participant tracks, SSRC/DOM)
        //   2. already-bound name for this diarized speaker
        //   3. co-occurrence voting vs the live DOM active speaker (multi-party)
        //   4. the SOLE known human participant — covers the common 1:1 case where
        //      no per-track binding exists (e.g. the mixed `meet-mixed`/`wasrc-*`
        //      streams the Web-Audio/element capture produces, which have no
        //      trackId↔name mapping). Without this they fall back to "Speaker N".
        //   5. the live DOM active speaker as a last-resort hint.
        const soleKnown = session.knownParticipants.size === 1 ? [...session.knownParticipants][0] : null;
        let name = session.trackNames.get(trackId) ?? session.speakerNames.get(key) ?? null;
        if (!name && isFinal) name = resolveSpeakerName(session, key, label);
        // Provisional fallback order favors STABILITY: the accumulated vote
        // leader stays constant across segments, whereas the raw DOM current
        // speaker flips whenever detection lags — the main cause of "names
        // change randomly mid-meeting". Wrong provisional names are corrected
        // retroactively when the vote binds.
        if (!name) name = soleKnown ?? voteLeader(session, key) ?? session.currentSpeaker ?? null;
        if (isPseudoParticipantName(name)) name = soleKnown;

        const identified = { ...segment, speakerName: name, speakerLabel: label };
        if (isFinal) {
          console.log(
            `[transcript] ${trackId.slice(0, 8)} ${name ?? label}: ${identified.text}` +
            ` (→ ${session.panelClients.size} panel client(s))`
          );
          diag(`TRANSCRIPT ${trackId.slice(0, 8)} "${identified.text}" → ${session.panelClients.size} panel client(s)`);
        }
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
        if (isFinal) persistSegment(session, identified);
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
  // Presentation/screen-share tiles are not people — never bind them to a track.
  if (isPseudoParticipantName(name)) return;
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

  // Give any in-flight final transcripts a brief moment to arrive after the STT
  // sockets are told to finish, so they make it into the buffer before we flush.
  await new Promise(r => setTimeout(r, 500));

  // ── Persistence safety net ────────────────────────────────────────────────
  // Re-persist every finalized segment buffered this session. Live saves may
  // have failed transiently (DB blip, missing table, etc.); this bulk upsert
  // (ON CONFLICT DO NOTHING) guarantees the full transcript is saved at meeting
  // end. Logged via diag() so the result is visible on an elevated backend.
  if (session.transcriptBuffer.length > 0) {
    try {
      const saved = await saveSegmentsBulk(session.meetingId, session.transcriptBuffer);
      diag(`FLUSH ${meetingCode}: persisted ${saved}/${session.transcriptBuffer.length} buffered segment(s) at meeting end`);
    } catch (err) {
      diag(`⚠ FLUSH FAILED for ${meetingCode}: ${(err as Error).message} — ${session.transcriptBuffer.length} segment(s) may be lost`);
    }
  } else {
    diag(`FLUSH ${meetingCode}: no segments buffered (meeting produced no transcript)`);
  }

  await endMeeting(session.meetingId).catch(err =>
    diag(`⚠ endMeeting FAILED for ${meetingCode}: ${(err as Error).message}`));
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

    // All processing complete — email the owner their results (summary, action
    // items, decisions, links, PDF report). Best-effort and idempotent.
    try {
      const { sendMeetingSummaryEmail } = await import('../services/notificationService');
      await sendMeetingSummaryEmail(meetingId);
    } catch (err) {
      console.error(`[pipeline] Post-meeting email failed for ${meetingCode}:`, (err as Error).message);
    }
  } catch (err) {
    console.error(`[pipeline] Unhandled error for ${meetingCode}:`, (err as Error).message);
    // Even on a top-level crash, leave a row in the table — saveSummary fallback so UI shows something
    try {
      await saveSummary(meetingId, 'Analysis failed. The transcript is preserved.', [], '', []);
    } catch {}
  }
}