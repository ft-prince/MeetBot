/**
 * RecallBot — manages the lifecycle of a Recall.ai cloud bot.
 *
 * Unlike ZoomBot (which runs a local Chromium instance), RecallBot simply:
 *   1. Calls the Recall API to create a cloud bot that joins the meeting
 *   2. Registers the botId → meetingCode mapping so the webhook can route segments
 *   3. Polls Recall's status endpoint every 10s to detect when the meeting ends
 *
 * Transcription data flows via the webhook:
 *   Recall → POST /api/recall/webhook → forwardRecallSegment → panel WebSocket
 */
import { config } from '../config';
import { createBot, getBot, stopBot, latestStatus } from '../services/recallService';

// Global registry: botId → meetingCode
// Shared with routes/recall.ts so the webhook handler can route incoming segments.
export const botIdToMeetingCode = new Map<string, string>();

export interface RecallBotOptions {
  meetingUrl: string;
  meetingCode: string;
  displayName?: string;
  onJoined?: () => void;
  onEnded?: () => void;
  onError?: (err: Error) => void;
}

// Terminal Recall status codes — any of these means the call is over
const TERMINAL_STATUSES = new Set([
  'call_ended',
  'done',
  'fatal',
  'recording_permission_denied',
  'bot_kicked',
]);

export class RecallBot {
  private botId: string | null = null;
  private _lastBotId: string | null = null;  // persists after stop() — used to fetch final transcript
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private ended = false;

  /** Returns the most recent botId, even after stop() has been called. */
  get lastBotId(): string | null {
    return this._lastBotId;
  }

  async start(opts: RecallBotOptions): Promise<void> {
    const lang = (process.env.DEEPGRAM_LANGUAGE || 'en').trim();
    const webhookUrl = config.recall.webhookUrl;

    if (!webhookUrl) {
      console.warn(
        '[recall-bot] RECALL_WEBHOOK_URL not set — live transcription disabled.\n' +
        '             Set it to your public server URL + /api/recall/webhook\n' +
        '             (use ngrok for local dev: ngrok http 8001)'
      );
    }

    console.log(`[recall-bot] Launching for ${opts.meetingUrl} | lang=${lang} | webhook=${webhookUrl || 'none'}`);

    const bot = await createBot(
      opts.meetingUrl,
      opts.displayName || 'NoteAI Recorder',
      lang,
      webhookUrl,
    );

    this.botId = bot.id;
    this._lastBotId = bot.id;
    botIdToMeetingCode.set(bot.id, opts.meetingCode);
    console.log(`[recall-bot] Created bot id=${bot.id} for meeting ${opts.meetingCode}`);

    opts.onJoined?.();

    // Poll every 10s to detect when the call ends
    this.pollInterval = setInterval(async () => {
      if (this.ended) return;
      try {
        const b = await getBot(this.botId!);
        const status = latestStatus(b);
        console.log(`[recall-bot] Status poll: ${status}`);

        if (TERMINAL_STATUSES.has(status)) {
          this.ended = true;
          clearInterval(this.pollInterval!);
          botIdToMeetingCode.delete(this.botId!);
          console.log(`[recall-bot] Meeting ended (status=${status})`);
          opts.onEnded?.();
        }
      } catch (err) {
        console.error('[recall-bot] Status poll error:', (err as Error).message);
      }
    }, 10_000);
  }

  async stop(): Promise<void> {
    this.ended = true;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.botId) {
      botIdToMeetingCode.delete(this.botId);
      try {
        await stopBot(this.botId);
        console.log(`[recall-bot] Bot ${this.botId} left the meeting`);
      } catch (err) {
        // Bot may have already left — not a fatal error
        console.warn('[recall-bot] stop() error (may already be gone):', (err as Error).message);
      }
      this.botId = null;
    }
  }
}
