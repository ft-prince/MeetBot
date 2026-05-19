import { createClient, LiveTranscriptionEvents, LiveClient } from '@deepgram/sdk'
import { v4 as uuidv4 } from 'uuid'
import type { TranscriptSegment } from '../services/speakerCorrelator'

export type OnTranscriptCallback = (segment: TranscriptSegment, isFinal: boolean) => void

const API_KEY = process.env.deepgram_api_key || process.env.DEEPGRAM_API_KEY || ''

export class DeepgramClient {
  private live: LiveClient | null = null
  private isOpen = false
  private shouldReconnect = true
  private audioQueue: Buffer[] = []
  private firstAudioWallMs: number | null = null

  constructor(
    private readonly onTranscript: OnTranscriptCallback,
    private readonly onError?: (err: unknown) => void
  ) {}

  connect(): void {
    this.shouldReconnect = true
    this.open()
  }

  sendAudio(chunk: Buffer | ArrayBuffer): void {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    // Anchor wall-clock time to the first audio chunk so we can translate
    // Deepgram's stream-relative timestamps into Date.now()-compatible ms.
    if (this.firstAudioWallMs == null) this.firstAudioWallMs = Date.now()
    if (!this.isOpen || !this.live) {
      this.audioQueue.push(buf)
      return
    }
    this.live.send(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
  }

  get streamStartWallMs(): number | null {
    return this.firstAudioWallMs
  }

  disconnect(): void {
    this.shouldReconnect = false
    this.isOpen = false
    this.firstAudioWallMs = null
    try { this.live?.finish() } catch {}
    this.live = null
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

    this.live = dg.listen.live({
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

    this.live.on(LiveTranscriptionEvents.Open, () => {
      this.isOpen = true
      console.log('[deepgram-client] Connected')
      // Flush any audio that arrived before the connection was ready
      for (const buf of this.audioQueue) this.live!.send(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
      this.audioQueue = []
      // Send keepalive every 8s so silent tracks don't get disconnected by Deepgram
      const ka = setInterval(() => {
        if (!this.isOpen || !this.live) { clearInterval(ka); return }
        try { this.live.keepAlive() } catch {}
      }, 8000)
      this.live!.once(LiveTranscriptionEvents.Close, () => clearInterval(ka))
    })

    this.live.on(LiveTranscriptionEvents.Transcript, (data) => {
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

      const startMs = Math.round((data.start ?? 0) * 1000)
      const duration = data.duration ?? 0
      const endMs = Math.round((data.start + duration) * 1000)

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

    this.live.on(LiveTranscriptionEvents.Error, (err) => {
      this.isOpen = false
      console.error('[deepgram-client] Error:', err)
      this.onError?.(err)
    })

    this.live.on(LiveTranscriptionEvents.Close, () => {
      this.isOpen = false
      if (this.shouldReconnect) {
        console.log('[deepgram-client] Disconnected — reconnecting in 3s...')
        setTimeout(() => this.open(), 3000)
      }
    })
  }
}