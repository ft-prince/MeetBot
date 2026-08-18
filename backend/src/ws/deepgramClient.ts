import { createClient, LiveTranscriptionEvents, LiveClient } from '@deepgram/sdk'
import { v4 as uuidv4 } from 'uuid'
import type { TranscriptSegment } from '../services/speakerCorrelator'

export type OnTranscriptCallback = (segment: TranscriptSegment, isFinal: boolean) => void

const API_KEY = process.env.deepgram_api_key || process.env.DEEPGRAM_API_KEY || ''

const RECONNECT_DELAY_MS = 3000
// Audio buffered while the socket is down/absent: 300 × 200ms chunks ≈ 60s.
// Bounded so a long outage can't grow memory without limit; oldest audio is
// dropped first (the most recent speech is the most valuable to transcribe).
const MAX_QUEUE_CHUNKS = 300
// 16 kHz × 16-bit mono = 32 bytes of PCM per millisecond. Used to keep segment
// timestamps monotonic across reconnects (Deepgram's clock restarts at 0 on
// every new connection).
const BYTES_PER_MS = 32
// Liveness watchdog: if AUDIBLE audio has been flowing out but Deepgram has
// sent nothing back for STALL_MS, the socket is half-open (dead TCP path that
// never emitted 'close' — typical after a network blip during a long silent
// stretch). Tear it down and reconnect so transcription resumes on its own.
// Pure silence never triggers this: with no audible audio there is nothing to
// expect back, so quiet meetings don't cause reconnect churn.
const WATCHDOG_INTERVAL_MS = 10_000
const AUDIBLE_RECENT_MS = 15_000
const STALL_MS = 30_000
const AUDIBLE_RMS = 0.005

export class DeepgramClient {
  private live: LiveClient | null = null
  private isOpen = false
  private shouldReconnect = true
  private audioQueue: Buffer[] = []
  private queueDropWarned = false
  private reconnectTimer: NodeJS.Timeout | null = null
  private watchdog: NodeJS.Timeout | null = null
  private bytesSentTotal = 0   // audio bytes sent across ALL connections
  private connOffsetMs = 0     // ms of audio sent before the CURRENT connection
  private lastEventAt = 0      // last time Deepgram sent us anything at all
  private lastAudibleAt = 0    // last time WE sent non-silent audio

  constructor(
    private readonly onTranscript: OnTranscriptCallback,
    private readonly onError?: (err: unknown) => void
  ) {}

  connect(): void {
    this.shouldReconnect = true
    this.open()
    if (!this.watchdog) {
      this.watchdog = setInterval(() => this.checkLiveness(), WATCHDOG_INTERVAL_MS)
      this.watchdog.unref?.()
    }
  }

  sendAudio(chunk: Buffer | ArrayBuffer): void {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)

    // Cheap audibility probe (every 8th sample) — feeds the liveness watchdog.
    const samples = Math.floor(buf.byteLength / 2)
    if (samples > 0) {
      let sum = 0, m = 0
      for (let i = 0; i < samples; i += 8) {
        const v = buf.readInt16LE(i * 2) / 32768
        sum += v * v
        m++
      }
      if (Math.sqrt(sum / m) >= AUDIBLE_RMS) this.lastAudibleAt = Date.now()
    }

    if (!this.isOpen || !this.live) {
      this.audioQueue.push(buf)
      if (this.audioQueue.length > MAX_QUEUE_CHUNKS) {
        this.audioQueue.shift()
        if (!this.queueDropWarned) {
          this.queueDropWarned = true
          console.warn('[deepgram-client] Reconnect queue full — dropping oldest audio (will keep the most recent ~60s)')
        }
      }
      return
    }
    this.sendBuf(buf)
  }

  disconnect(): void {
    this.shouldReconnect = false
    this.isOpen = false
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    if (this.watchdog) { clearInterval(this.watchdog); this.watchdog = null }
    try { this.live?.finish() } catch {}
    this.live = null
  }

  private sendBuf(buf: Buffer): void {
    this.live!.send(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
    this.bytesSentTotal += buf.byteLength
  }

  // Schedule a single reconnect attempt. Guarded so overlapping triggers
  // (close + error + watchdog) can never open duplicate connections.
  private scheduleReconnect(reason: string): void {
    if (!this.shouldReconnect || this.reconnectTimer) return
    console.log(`[deepgram-client] ${reason} — reconnecting in ${RECONNECT_DELAY_MS}ms...`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.open()
    }, RECONNECT_DELAY_MS)
  }

  private checkLiveness(): void {
    if (!this.isOpen || !this.live) return
    const now = Date.now()
    if (now - this.lastAudibleAt > AUDIBLE_RECENT_MS) return   // silence — nothing to expect back
    if (now - this.lastEventAt < STALL_MS) return               // responses are flowing
    console.warn('[deepgram-client] Audible audio is flowing but Deepgram has been silent for ' +
      `${Math.round((now - this.lastEventAt) / 1000)}s — connection looks half-open, forcing reconnect`)
    const dead = this.live
    this.isOpen = false
    this.live = null   // audio now queues until the new connection opens
    try { dead.finish() } catch {}
    this.scheduleReconnect('Stalled connection')
  }

  private open(): void {
    if (!API_KEY) {
      console.error('[deepgram-client] Missing API key — set deepgram_api_key in .env')
      return
    }

    console.log('[deepgram-client] Connecting...')
    const dg = createClient(API_KEY)

    // 'multi' = automatic Spanish+English detection; override with any nova-2 language code
    // e.g. DEEPGRAM_LANGUAGE=hi for Hindi, DEEPGRAM_LANGUAGE=zh for Mandarin
    const language = process.env.DEEPGRAM_LANGUAGE || 'multi'
    console.log(`[deepgram-client] Model: nova-2 | Language: ${language}`)

    const conn = dg.listen.live({
      model: 'nova-2',
      language,
      smart_format: true,
      interim_results: true,
      diarize: true,
      encoding: 'linear16',
      sample_rate: 16000,
      channels: 1,
      utterance_end_ms: 1000,
    })
    this.live = conn

    conn.on(LiveTranscriptionEvents.Open, () => {
      if (this.live !== conn) { try { conn.finish() } catch {}; return }  // superseded while connecting
      this.isOpen = true
      this.lastEventAt = Date.now()
      // Timestamps from this connection restart at 0; everything sent before it
      // (including the queue flushed below) offsets segment times so the meeting
      // timeline stays monotonic across reconnects.
      this.connOffsetMs = Math.round(this.bytesSentTotal / BYTES_PER_MS)
      console.log('[deepgram-client] Connected' + (this.connOffsetMs > 0 ? ` (resumed at +${Math.round(this.connOffsetMs / 1000)}s of audio)` : ''))
      // Flush any audio that arrived before the connection was ready
      const queued = this.audioQueue
      this.audioQueue = []
      this.queueDropWarned = false
      for (const buf of queued) this.sendBuf(buf)
      // Send keepalive every 8s so silent tracks don't get disconnected by Deepgram
      const ka = setInterval(() => {
        if (this.live !== conn || !this.isOpen) { clearInterval(ka); return }
        try { conn.keepAlive() } catch {}
      }, 8000)
      ka.unref?.()
      conn.once(LiveTranscriptionEvents.Close, () => clearInterval(ka))
    })

    // Any inbound event proves the connection is live — feed the watchdog.
    conn.on(LiveTranscriptionEvents.Metadata, () => { this.lastEventAt = Date.now() })
    conn.on(LiveTranscriptionEvents.UtteranceEnd, () => { this.lastEventAt = Date.now() })
    conn.on(LiveTranscriptionEvents.SpeechStarted, () => { this.lastEventAt = Date.now() })

    conn.on(LiveTranscriptionEvents.Transcript, (data) => {
      this.lastEventAt = Date.now()
      const alt = data.channel?.alternatives?.[0]
      const text = alt?.transcript?.trim()
      if (!text) return

      const isFinal = data.is_final === true
      const words = alt?.words ?? []

      // Pick dominant speaker from word-level diarization
      const speakerCounts: Record<number, number> = {}
      for (const w of words) {
        if (w.speaker != null) speakerCounts[w.speaker] = (speakerCounts[w.speaker] ?? 0) + 1
      }
      const dominantSpeaker = Object.entries(speakerCounts).sort((a, b) => b[1] - a[1])[0]
      const speakerNum = dominantSpeaker ? Number(dominantSpeaker[0]) : 0

      const startMs = this.connOffsetMs + Math.round((data.start ?? 0) * 1000)
      const duration = data.duration ?? 0
      const endMs = this.connOffsetMs + Math.round((data.start + duration) * 1000)

      const segment: TranscriptSegment = {
        segmentId: uuidv4(),
        speakerLabel: `SPEAKER_${speakerNum}`,
        text,
        startMs,
        endMs,
        confidence: alt?.confidence,
      }

      this.onTranscript(segment, isFinal)
    })

    conn.on(LiveTranscriptionEvents.Error, (err) => {
      console.error('[deepgram-client] Error:', err)
      this.onError?.(err)
      if (this.live !== conn) return
      // Some failures never emit Close (half-open sockets, TLS resets swallowed
      // by the SDK). Treat an error as connection-fatal and reconnect ourselves
      // so transcription can never silently stop for the rest of the meeting.
      this.isOpen = false
      this.live = null
      try { conn.finish() } catch {}
      this.scheduleReconnect('Connection error')
    })

    conn.on(LiveTranscriptionEvents.Close, () => {
      if (this.live !== conn) return   // an older/superseded socket closing late
      this.isOpen = false
      this.live = null
      this.scheduleReconnect('Disconnected')
    })
  }
}
