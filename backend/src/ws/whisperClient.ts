import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import type { TranscriptSegment } from '../services/speakerCorrelator';

export type OnTranscriptCallback = (segment: TranscriptSegment, isFinal: boolean) => void;

const WHISPER_URL = 'ws://localhost:3002';
const RECONNECT_DELAY_MS = 3000;

export class WhisperClient {
  private ws: WebSocket | null = null;
  private isOpen = false;
  private shouldReconnect = true;

  constructor(
    private readonly onTranscript: OnTranscriptCallback,
    private readonly onError?: (err: unknown) => void
  ) {}

  connect(): void {
    this.shouldReconnect = true;
    this.openSocket();
  }

  sendAudio(chunk: Buffer | ArrayBuffer): void {
    if (!this.isOpen || !this.ws) return;
    this.ws.send(chunk);
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.isOpen = false;
    this.ws?.close();
    this.ws = null;
  }

  private openSocket(): void {
    console.log('[whisper-client] Connecting to whisper service...');
    this.ws = new WebSocket(WHISPER_URL);

    this.ws.on('open', () => {
      this.isOpen = true;
      console.log('[whisper-client] Connected to whisper service');
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as {
          type: string;
          text: string;
          start_ms: number;
          end_ms: number;
          speaker: string;
          confidence?: number;
        };

        if (msg.type !== 'transcript' || !msg.text?.trim()) return;

        const segment: TranscriptSegment = {
          segmentId: uuidv4(),
          speakerLabel: msg.speaker ?? 'SPEAKER_0',
          text: msg.text.trim(),
          startMs: msg.start_ms,
          endMs: msg.end_ms,
          confidence: msg.confidence,
        };

        // Whisper returns final results only (no streaming mid-sentence)
        this.onTranscript(segment, true);
      } catch (err) {
        console.error('[whisper-client] Bad message from service:', err);
      }
    });

    this.ws.on('close', () => {
      this.isOpen = false;
      if (this.shouldReconnect) {
        console.log(`[whisper-client] Disconnected — retrying in ${RECONNECT_DELAY_MS}ms`);
        setTimeout(() => this.openSocket(), RECONNECT_DELAY_MS);
      }
    });

    this.ws.on('error', (err) => {
      this.isOpen = false;
      console.error('[whisper-client] Error:', err.message);
      this.onError?.(err);
    });
  }
}
