import { config } from '../config';
import { DeepgramClient } from './deepgramClient';
import { WhisperClient, type OnTranscriptCallback } from './whisperClient';

/**
 * Common shape implemented by every STT client (Deepgram, WhisperX, AIKosh).
 * Lets the ingest layer stay engine-agnostic — it only ever sees this contract.
 */
export interface SttClient {
  connect(): void;
  sendAudio(chunk: Buffer | ArrayBuffer): void;
  disconnect(): void;
}

/**
 * Build the STT client for the configured engine (STT_ENGINE env).
 *   deepgram → Deepgram nova-2 streaming (cloud)
 *   whisper  → local WhisperX sidecar (:3002)
 *   aikosh   → local AIKosh / AI4Bharat IndicConformer sidecar (:3003)
 *
 * WhisperX and AIKosh share an identical wire protocol, so the same
 * WhisperClient implementation serves both — only the URL differs.
 */
export function createSttClient(
  onTranscript: OnTranscriptCallback,
  onError?: (err: unknown) => void
): SttClient {
  switch (config.sttEngine) {
    case 'aikosh':
      return new WhisperClient(onTranscript, onError, config.aikoshSttUrl);
    case 'whisper':
      return new WhisperClient(onTranscript, onError, config.whisperUrl);
    case 'deepgram':
    default:
      return new DeepgramClient(onTranscript, onError);
  }
}
