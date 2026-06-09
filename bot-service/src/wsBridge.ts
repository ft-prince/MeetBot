import WebSocket from 'ws';

type Callback = () => void;

/**
 * WebSocket bridge from the Docker bot to the backend /audio endpoint.
 *
 * Protocol:
 *   binary frame              → PCM audio for the currently-selected track
 *   { type: 'track_select' }  → switch which Deepgram stream subsequent binary goes to
 *   { type: 'track_info' }    → bind a display name to a track id
 *   other JSON                → forwarded as-is (speaker_start, speaker_end, etc.)
 */
export class WsBridge {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private currentTrackId: string | null = null;
  private onReadyCallbacks: Callback[] = [];

  constructor(private readonly wsUrl: string) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.once('open', () => {
        console.log('[bridge] Connected to backend:', this.wsUrl);
        this.onReadyCallbacks.forEach(fn => fn());
        this.onReadyCallbacks = [];
        resolve();
      });

      this.ws.once('error', (err) => {
        console.error('[bridge] Connection error:', err.message);
        reject(err);
      });

      this.ws.on('close', () => {
        if (!this.closed) {
          console.warn('[bridge] Disconnected — reconnecting in 3 s');
          this.reconnectTimer = setTimeout(() => this.reconnect(), 3000);
        }
      });
    });
  }

  private reconnect(): void {
    this.ws?.removeAllListeners();
    this.ws = new WebSocket(this.wsUrl);
    this.ws.on('open', () => {
      console.log('[bridge] Reconnected');
      // Reselect the active track so the backend routes correctly after reconnect
      if (this.currentTrackId) {
        this.send(JSON.stringify({ type: 'track_select', trackId: this.currentTrackId }));
      }
    });
    this.ws.on('close', () => {
      if (!this.closed) {
        this.reconnectTimer = setTimeout(() => this.reconnect(), 3000);
      }
    });
    this.ws.on('error', (err) => console.error('[bridge] Error:', err.message));
  }

  private send(data: Buffer | string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  /**
   * Forward a PCM chunk. Sends a track_select message first if the track changed.
   */
  sendAudio(chunk: Buffer, trackId: string): void {
    if (trackId !== this.currentTrackId) {
      this.currentTrackId = trackId;
      this.send(JSON.stringify({ type: 'track_select', trackId }));
    }
    this.send(chunk);
  }

  /**
   * Associate a human-readable name with a track id.
   */
  sendTrackInfo(trackId: string, name: string): void {
    this.send(JSON.stringify({ type: 'track_info', trackId, name }));
  }

  /**
   * Forward a control event (speaker_start, speaker_end, screenshare_*, etc.).
   */
  sendEvent(payload: Record<string, unknown>): void {
    this.send(JSON.stringify(payload));
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
