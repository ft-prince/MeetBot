import { v5 as uuidv5 } from 'uuid';
import WebSocket from 'ws';
import { config } from '../config';
import type { IdentifiedSegment } from '../services/speakerCorrelator';

// Fixed namespace so a given (session_uid, start) always maps to the same UUID.
// RFC-4122 standard DNS namespace (a valid v1 UUID accepted by uuid.v5).
const VEXA_SEGMENT_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

// Vexa (https://github.com/Vexa-ai/vexa) is a self-hosted, open-source meeting
// bot API. We POST a bot into the meeting, stream live per-speaker segments over
// its WebSocket for the panel, and fetch the authoritative transcript over REST
// when the meeting completes. No browser automation, so nothing to be detected.

export type VexaPlatform = 'google_meet' | 'zoom' | 'teams';

const PING_INTERVAL_MS = 25_000;
const MAX_DURATION_MS = 4 * 60 * 60 * 1_000;
const STOP_DRAIN_MS = 10_000;

interface VexaSegment {
  text?: string;
  speaker?: string | null;
  start?: number;      // relative seconds from meeting start (WS and REST)
  end?: number;        // WS bundle format (segment-publisher.ts publishes 'end')
  end_time?: number;   // REST format / legacy
  session_uid?: string;
  segment_id?: string; // stable ID from vexa-bot (preferred for upsert key)
}

interface VexaTranscriptResponse {
  segments?: VexaSegment[];
}

// Vexa WS publishes type='transcript' bundles (per-speaker, confirmed + pending).
// 'transcript.mutable' / 'transcript.finalized' are legacy and no longer sent.
interface VexaWsMessage {
  type?: string;
  // transcript bundle (type === 'transcript')
  speaker?: string;
  confirmed?: VexaSegment[];
  pending?: VexaSegment[];
  // meeting.status payload
  payload?: { segments?: VexaSegment[]; status?: string };
  status?: string;
  data?: { status?: string };
}

export interface VexaBotCallbacks {
  onJoined: () => void;
  onSegment: (segment: IdentifiedSegment) => void;
  onEnded: (segments: IdentifiedSegment[]) => void;
  onError: (err: Error) => void;
}

export class VexaBot {
  private ws: WebSocket | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private maxTimer: NodeJS.Timeout | null = null;
  private drainTimer: NodeJS.Timeout | null = null;
  private joinedFired = false;
  private finished = false;

  constructor(
    private readonly platform: VexaPlatform,
    private readonly nativeId: string,
  ) {}

  async start(callbacks: VexaBotCallbacks): Promise<void> {
    const { apiUrl, apiKey, botName, language } = config.vexa;
    if (!apiKey) throw new Error('VEXA_API_KEY is not configured');

    const body: Record<string, unknown> = {
      platform: this.platform,
      native_meeting_id: this.nativeId,
      bot_name: botName,
    };
    if (language) body.language = language;

    const res = await fetch(`${apiUrl}/bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Vexa POST /bots ${res.status}: ${text}`);
    }
    console.log(`[vexa] Bot requested for ${this.platform}/${this.nativeId}`);

    this.connectWs(callbacks);
    this.maxTimer = setTimeout(() => this.finish(callbacks), MAX_DURATION_MS);
  }

  async stop(callbacks: VexaBotCallbacks): Promise<void> {
    const { apiUrl, apiKey } = config.vexa;
    try {
      const res = await fetch(`${apiUrl}/bots/${this.platform}/${this.nativeId}`, {
        method: 'DELETE',
        headers: { 'X-API-Key': apiKey },
      });
      if (!res.ok) {
        console.warn(`[vexa] DELETE bot ${res.status}: ${await res.text()}`);
      }
    } catch (err) {
      console.error('[vexa] stop error:', err);
    }
    // Give the WS a moment to deliver any tail segments + a completed status,
    // then finalize regardless so we never hang on a missed status event.
    this.drainTimer = setTimeout(() => this.finish(callbacks), STOP_DRAIN_MS);
  }

  private connectWs(callbacks: VexaBotCallbacks): void {
    const { apiUrl, apiKey } = config.vexa;
    const wsUrl = apiUrl.replace(/^http/, 'ws') + '/ws';

    const ws = new WebSocket(wsUrl, { headers: { 'X-API-Key': apiKey } });
    this.ws = ws;

    ws.on('open', () => {
      ws.send(JSON.stringify({
        action: 'subscribe',
        meetings: [{ platform: this.platform, native_id: this.nativeId }],
      }));
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action: 'ping' }));
      }, PING_INTERVAL_MS);
    });

    ws.on('message', (raw) => this.handleMessage(raw.toString(), callbacks));
    ws.on('error', (err) => console.error('[vexa] WS error:', err.message));
    ws.on('close', () => this.clearTimers());
  }

  private handleMessage(raw: string, callbacks: VexaBotCallbacks): void {
    let msg: VexaWsMessage;
    try {
      msg = JSON.parse(raw) as VexaWsMessage;
    } catch {
      return;
    }

    // Current Vexa format: per-speaker transcript bundles with confirmed + pending arrays.
    // 'transcript.mutable' / 'transcript.finalized' are legacy and no longer published.
    if (msg.type === 'transcript') {
      if (!this.joinedFired) {
        this.joinedFired = true;
        callbacks.onJoined();
      }
      // Use confirmed segments (finalized text). Pending segments are in-flight
      // (still being transcribed) — we skip them to avoid noisy partial updates.
      const speaker = msg.speaker ?? null;
      for (const seg of msg.confirmed ?? []) {
        // Speaker on the bundle top-level overrides per-segment (bundle is per-speaker)
        const identified = toIdentified({ ...seg, speaker: seg.speaker ?? speaker });
        if (identified.text) callbacks.onSegment(identified);
      }
      return;
    }

    if (msg.type === 'meeting.status') {
      const status = msg.payload?.status ?? msg.status ?? msg.data?.status;
      if (status === 'active' && !this.joinedFired) {
        this.joinedFired = true;
        callbacks.onJoined();
      }
      if (status === 'completed' || status === 'failed') {
        this.finish(callbacks);
      }
    }
  }

  private async finish(callbacks: VexaBotCallbacks): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    this.clearTimers();
    this.ws?.close();

    const segments = await this.fetchTranscript();
    callbacks.onEnded(segments);
  }

  private async fetchTranscript(): Promise<IdentifiedSegment[]> {
    const { apiUrl, apiKey } = config.vexa;
    try {
      const res = await fetch(
        `${apiUrl}/transcripts/${this.platform}/${this.nativeId}`,
        { headers: { 'X-API-Key': apiKey } },
      );
      if (!res.ok) {
        console.warn(`[vexa] transcript fetch ${res.status}`);
        return [];
      }
      const data = await res.json() as VexaTranscriptResponse;
      const segments = (data.segments ?? [])
        .map((seg) => toIdentified(seg))
        .filter((seg) => seg.text);
      console.log(`[vexa] Fetched ${segments.length} final segments`);
      return segments;
    } catch (err) {
      console.error('[vexa] fetchTranscript error:', err);
      return [];
    }
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.maxTimer) clearTimeout(this.maxTimer);
    if (this.drainTimer) clearTimeout(this.drainTimer);
    this.pingTimer = this.maxTimer = this.drainTimer = null;
  }
}

function toIdentified(seg: VexaSegment): IdentifiedSegment {
  const name = seg.speaker?.trim() || null;
  const startMs = Math.round((seg.start ?? 0) * 1000);
  // WS bundles publish 'end'; REST response uses 'end_time'. Accept both.
  const endMs = Math.round((seg.end ?? seg.end_time ?? seg.start ?? 0) * 1000);
  // Prefer the stable segment_id from the bot (format: {session_uid}:{speaker}:{seq}).
  // Fall back to hashing (session_uid, start) so segments stay stable across WS updates.
  const stableKey = seg.segment_id ?? `${seg.session_uid ?? 'seg'}:${startMs}`;
  return {
    segmentId: uuidv5(stableKey, VEXA_SEGMENT_NAMESPACE),
    speakerLabel: name ?? 'Speaker',
    speakerName: name,
    text: (seg.text ?? '').trim(),
    startMs,
    endMs,
    confidence: 1,
  };
}
