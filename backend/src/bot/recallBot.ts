import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import type { IdentifiedSegment } from '../services/speakerCorrelator';

const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_DURATION_MS = 4 * 60 * 60 * 1_000;

type BotStatusCode =
  | 'ready'
  | 'joining_call'
  | 'in_waiting_room'
  | 'in_call_not_recording'
  | 'in_call_recording'
  | 'call_ended'
  | 'done'
  | 'fatal';

interface RecallBotApiResponse {
  id: string;
  status_changes: Array<{ code: BotStatusCode; message: string | null; created_at: string }>;
}

interface RecallWord {
  text: string;
  start_timestamp?: { relative?: number };
  end_timestamp?: { relative?: number };
}

interface RecallTranscriptRow {
  speaker: string;
  words: RecallWord[];
}

interface RecallTranscriptListResponse {
  results: RecallTranscriptRow[];
  next: string | null;
}

export interface RecallBotCallbacks {
  onJoined: () => void;
  onEnded: (segments: IdentifiedSegment[]) => void;
  onError: (err: Error) => void;
}

export class RecallBot {
  private botId: string | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private startTime = 0;
  private joinedFired = false;

  async start(meetingUrl: string, displayName: string, callbacks: RecallBotCallbacks): Promise<void> {
    const { apiKey, baseUrl } = config.recall;
    if (!apiKey) throw new Error('RECALL_API_KEY is not configured');

    this.startTime = Date.now();

    const createUrl = `${baseUrl}/bot/`;
    console.log(`[recall] POST ${createUrl}`);

    const res = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        meeting_url: meetingUrl,
        bot_name: displayName,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Recall API ${res.status}: ${body}`);
    }

    const bot = await res.json() as RecallBotApiResponse;
    this.botId = bot.id;
    console.log(`[recall] Bot created id=${this.botId}`);

    this.pollTimer = setInterval(() => {
      this.pollStatus(callbacks).catch(err =>
        console.error('[recall] Poll error:', err)
      );
    }, POLL_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    if (!this.botId) return;
    try {
      const { apiKey, baseUrl } = config.recall;
      const res = await fetch(`${baseUrl}/bot/${this.botId}/leave_call/`, {
        method: 'POST',
        headers: { 'Authorization': `Token ${apiKey}` },
      });
      if (!res.ok) {
        const body = await res.text();
        console.warn(`[recall] leave_call ${res.status}: ${body}`);
      } else {
        console.log(`[recall] Bot ${this.botId} instructed to leave`);
      }
      // Keep polling — the next poll will detect call_ended/done,
      // fetch the transcript, and fire onEnded.
    } catch (err) {
      console.error('[recall] stop error:', err);
    }
  }

  getBotId(): string | null {
    return this.botId;
  }

  private clearPoll(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async pollStatus(callbacks: RecallBotCallbacks): Promise<void> {
    if (!this.botId) return;

    const { apiKey, baseUrl } = config.recall;
    const res = await fetch(`${baseUrl}/bot/${this.botId}/`, {
      headers: { 'Authorization': `Token ${apiKey}` },
    });

    if (!res.ok) {
      console.warn(`[recall] Status poll ${res.status}`);
      return;
    }

    const bot = await res.json() as RecallBotApiResponse;
    const changes = bot.status_changes ?? [];
    const latest = changes[changes.length - 1]?.code;

    if (latest) console.log(`[recall] Bot ${this.botId} status: ${latest}`);

    if (latest === 'in_call_recording' && !this.joinedFired) {
      this.joinedFired = true;
      callbacks.onJoined();
    }

    if (latest === 'fatal') {
      this.clearPoll();
      const msg = changes[changes.length - 1]?.message ?? 'unknown';
      callbacks.onError(new Error(`Recall bot fatal: ${msg}`));
      return;
    }

    const isDone = latest === 'done' || latest === 'call_ended';
    const timedOut = Date.now() - this.startTime > MAX_POLL_DURATION_MS;

    if (isDone || timedOut) {
      this.clearPoll();
      const segments = await this.fetchTranscript();
      callbacks.onEnded(segments);
    }
  }

  private async fetchTranscript(): Promise<IdentifiedSegment[]> {
    if (!this.botId) return [];

    try {
      const { apiKey, baseUrl } = config.recall;
      // Use the updated transcript endpoint (not the legacy /bot/{id}/transcript/)
      const res = await fetch(`${baseUrl}/transcript/?bot_id=${this.botId}`, {
        headers: { 'Authorization': `Token ${apiKey}` },
      });

      if (!res.ok) {
        console.warn(`[recall] Transcript fetch ${res.status}`);
        return [];
      }

      const data = await res.json() as RecallTranscriptListResponse;
      const rows = data.results ?? [];
      console.log(`[recall] Fetched ${rows.length} transcript rows`);
      return rowsToSegments(rows);
    } catch (err) {
      console.error('[recall] fetchTranscript error:', err);
      return [];
    }
  }
}

function rowsToSegments(rows: RecallTranscriptRow[]): IdentifiedSegment[] {
  const segments: IdentifiedSegment[] = [];

  for (const row of rows) {
    if (!row.words?.length) continue;

    // Split words into utterance chunks on gaps > 1 second
    const chunks: RecallWord[][] = [];
    let current: RecallWord[] = [];

    for (let i = 0; i < row.words.length; i++) {
      const word = row.words[i];
      const prev = row.words[i - 1];
      const gap = prev
        ? (word.start_timestamp?.relative ?? 0) - (prev.end_timestamp?.relative ?? 0)
        : 0;

      if (gap > 1 && current.length > 0) {
        chunks.push(current);
        current = [];
      }
      current.push(word);
    }
    if (current.length > 0) chunks.push(current);

    for (const chunk of chunks) {
      const text = chunk.map(w => w.text).join(' ').trim();
      if (!text) continue;

      const startMs = Math.round((chunk[0].start_timestamp?.relative ?? 0) * 1000);
      const endMs = Math.round((chunk[chunk.length - 1].end_timestamp?.relative ?? 0) * 1000);

      segments.push({
        segmentId: uuidv4(),
        speakerLabel: row.speaker || 'Speaker',
        speakerName: row.speaker || null,
        text,
        startMs,
        endMs,
        confidence: 1,
      });
    }
  }

  return segments;
}
