/**
 * Recall.ai API client.
 * Recall runs a managed cloud bot that joins Zoom/Meet and handles audio capture,
 * speaker attribution, and transcription — no local Playwright/Chromium needed.
 *
 * Docs: https://docs.recall.ai
 */
import { config } from '../config';

const { apiKey, apiBase } = config.recall;

export interface RecallBot {
  id: string;
  meeting_url: { meeting_id?: string; platform?: string };
  bot_name: string;
  status_changes?: Array<{
    code: string;
    sub_code?: string;
    message?: string;
    created_at: string;
  }>;
  recordings?: Array<{
    id: string;
    started_at?: string;
    completed_at?: string | null;
    media_shortcuts?: {
      transcript?: {
        id: string;
        status?: { code: string };
        data?: { download_url: string | null };
      };
    };
  }>;
}

function authHeaders(): Record<string, string> {
  if (!apiKey?.trim()) throw new Error('RECALL_API_KEY not set in .env');
  return {
    Authorization: `Token ${apiKey.trim()}`,
    'Content-Type': 'application/json',
  };
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${apiBase}${path}`;
  const res = await fetch(url, {
    method,
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Recall ${method} ${path} → ${res.status}: ${text}`);
  return text ? (JSON.parse(text) as T) : ({} as T);
}

/**
 * Create a Recall bot to join a meeting.
 *
 * Provider selection:
 *   lang = 'en'  → meeting_captions (Zoom native captions, speaker names built-in)
 *   lang = 'hi'  → deepgram_streaming with language:hi (Hindi support)
 *   lang = other → deepgram_streaming with that language code
 *
 * If webhookUrl is provided, Recall will POST real-time transcript chunks to it.
 */
export async function createBot(
  meetingUrl: string,
  botName = 'NoteAI Recorder',
  lang = 'en',
  webhookUrl = '',
): Promise<RecallBot> {
  // Provider selection:
  //   en      → Zoom/Teams native captions (best quality, speaker names built-in)
  //   hi/etc  → Deepgram nova-2 with explicit language code
  let provider: Record<string, unknown>;
  if (lang === 'en') {
    provider = { meeting_captions: {} };
  } else {
    provider = {
      deepgram_streaming: {
        model: 'nova-2',
        language: lang,              // e.g. 'hi' for Hindi
        smart_format: true,
        punctuate: true,
      },
    };
  }

  const realtime_endpoints = webhookUrl
    ? [{ type: 'webhook', url: webhookUrl, events: ['transcript.data'] }]
    : [];

  console.log(`[recall] Creating bot | provider config:`, JSON.stringify(provider));

  return call<RecallBot>('POST', '/bot/', {
    meeting_url: meetingUrl,
    bot_name: botName,
    recording_config: {
      transcript: { provider },
      realtime_endpoints,
    },
  });
}

/** Fetch current bot state (includes status_changes array). */
export async function getBot(botId: string): Promise<RecallBot> {
  return call<RecallBot>('GET', `/bot/${botId}/`);
}

/** Tell Recall to leave the meeting immediately. */
export async function stopBot(botId: string): Promise<void> {
  await call('POST', `/bot/${botId}/leave_call/`);
}

// ── Final transcript fetching (used after the meeting ends) ──────────────────

export interface RecallProcessedSegment {
  participant: { id: number; name: string };
  words: Array<{
    text: string;
    start_timestamp?: number | { relative: number };
    end_timestamp?: number | { relative: number };
  }>;
}

/**
 * Poll Recall every `intervalMs` until the transcript for THIS bot is processed
 * and a download URL is available. Returns null if it never becomes ready.
 *
 * Critically: we query the bot directly (GET /bot/{botId}/) and read transcripts
 * from bot.recordings[].media_shortcuts.transcript — this guarantees we only see
 * THIS bot's transcripts, not workspace-wide ones (which would return stale data
 * from previous meetings).
 */
export async function waitForTranscript(
  botId: string,
  maxAttempts = 30,
  intervalMs = 5000,
): Promise<string | null> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const bot = await getBot(botId);
      const recordings = bot.recordings ?? [];

      // Look through this bot's recordings for a ready transcript
      for (const recording of recordings) {
        const t = recording.media_shortcuts?.transcript;
        if (t?.status?.code === 'done' && t.data?.download_url) {
          console.log(`[recall] Transcript ready for botId=${botId}`);
          return t.data.download_url;
        }
      }

      const statuses = recordings
        .map(r => r.media_shortcuts?.transcript?.status?.code ?? 'no-transcript')
        .join(',');
      console.log(
        `[recall] Transcript not ready yet (attempt ${i + 1}/${maxAttempts}, recordings=${recordings.length}, statuses: ${statuses || 'none'})`,
      );
    } catch (err) {
      console.warn('[recall] waitForTranscript poll error:', (err as Error).message);
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return null;
}

/** Download the transcript JSON from the signed S3 URL Recall provides. */
export async function downloadTranscript(
  downloadUrl: string,
): Promise<RecallProcessedSegment[]> {
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`Recall transcript download failed: ${res.status}`);
  return (await res.json()) as RecallProcessedSegment[];
}

/**
 * Extract the latest status code from a bot's status_changes log.
 * Common codes: joining_call | in_waiting_room | in_call_not_recording |
 *               in_call_recording | call_ended | done | fatal
 */
export function latestStatus(bot: RecallBot): string {
  const changes = bot.status_changes ?? [];
  return changes.length ? changes[changes.length - 1].code : 'unknown';
}
