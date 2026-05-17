/**
 * zoomAudioInjector.js — Zoom Web Client edition (loopback capture)
 *
 * WHY THIS APPROACH:
 * Zoom Web Client does NOT use RTCPeerConnection.addTrack() for incoming audio.
 * It uses a proprietary audio engine (Zoom's own WASM/SDK) that decodes audio
 * internally and renders it directly to an AudioContext destination — meaning
 * no 'track' event ever fires on any RTCPeerConnection for received audio.
 *
 * SOLUTION:
 * We tap the AudioContext.destination itself using a MediaStreamDestinationNode
 * patched in before Zoom creates its AudioContext. Every sound Zoom plays
 * (all participants mixed) flows through this tap and gets sent as PCM to the bot.
 *
 * SPEAKER DETECTION:
 * Since we get mixed audio, we use Zoom's active-speaker DOM events and
 * participant panel to emit speaker_start/speaker_end events separately.
 *
 * ARCHITECTURE:
 *   Zoom AudioContext → [our tap node] → MediaStreamDestination
 *                                      → AudioWorklet (PCMSender)
 *                                      → noteAISendTrackAudio(samples, 'mixed')
 */

;(function () {
  'use strict'

  const SAMPLE_RATE   = 16000
  const CHUNK_SAMPLES = SAMPLE_RATE * 0.2   // 200ms chunks
  const SPEAK_THRESHOLD = 8
  const SPEAKER_POLL_MS = 300

  window.__noteAIInjectorLoaded = true
  window.__patchedPCs           = []
  window.__noteAITrackList      = []

  const meetingId = (function () {
    const m = location.pathname.match(/\/wc\/(\d+)\//)
    return m ? m[1] : `zoom-${Date.now()}`
  })()

  // ── Patch AudioContext to intercept Zoom's audio graph ──────────────────
  // We wrap AudioContext so that when Zoom creates one, we immediately attach
  // a tap node to its destination before any audio starts flowing.

  // Track ALL AudioContexts — Zoom creates multiple across its lifecycle.
  // The first one (pre-join) is the camera preview; the real meeting audio
  // context is created later. We tap every one >= 16kHz and let the worklet
  // send audio — only the one actually carrying speech will produce output.
  const allContexts = []
  const OrigAudioContext = window.AudioContext || window.webkitAudioContext

  class PatchedAudioContext extends OrigAudioContext {
    constructor (...args) {
      super(...args)
      if (this.sampleRate >= 16000) {
        allContexts.push(this)
        console.log('[NoteAI] AudioContext #' + allContexts.length + ' created — sample rate:', this.sampleRate)
        // Tap with increasing delays to catch both early and late contexts
        setTimeout(() => tapAudioContext(this, allContexts.length), 200)
        setTimeout(() => tapAudioContext(this, allContexts.length), 2000)
        setTimeout(() => tapAudioContext(this, allContexts.length), 5000)
      }
    }
  }

  window.AudioContext = PatchedAudioContext
  if (window.webkitAudioContext) window.webkitAudioContext = PatchedAudioContext

  // Also patch RTCPeerConnection for the __patchedPCs sentinel (used by zoomBot.ts)
  const OrigRTC = window.RTCPeerConnection
  function PatchedRTC (...args) {
    const pc = new OrigRTC(...args)
    window.__patchedPCs.push(pc)
    return pc
  }
  PatchedRTC.prototype = OrigRTC.prototype
  Object.assign(PatchedRTC, OrigRTC)
  window.RTCPeerConnection = PatchedRTC

  // ── Audio tap ────────────────────────────────────────────────────────────

  const tappedContexts = new Set()

  async function tapAudioContext (ctx, ctxIndex) {
    // Only tap each context once
    if (tappedContexts.has(ctx)) return
    tappedContexts.add(ctx)

    console.log('[NoteAI] Tapping AudioContext #' + ctxIndex + ' state:', ctx.state)

    try {
      if (ctx.state === 'suspended') await ctx.resume()
      if (ctx.state === 'closed') {
        console.log('[NoteAI] AudioContext #' + ctxIndex + ' is closed — skipping')
        return
      }

      // Build worklet inline
      const workletCode = `
        class PCMSender extends AudioWorkletProcessor {
          constructor () {
            super()
            this._buf       = []
            this._n         = 0
            this._chunkSize = ${CHUNK_SAMPLES}
            this._ratio     = sampleRate / 16000
            this._pos       = 0
            this._dbgCount  = 0
          }
          process (inputs) {
            const ch = inputs[0]?.[0]
            if (!ch) return true

            // DEBUG: log audio level every ~1s (128 samples per call, ~375 calls/s at 48k)
            this._dbgCount++
            if (this._dbgCount % 350 === 0) {
              let sum = 0, peak = 0
              for (let i = 0; i < ch.length; i++) {
                const a = Math.abs(ch[i])
                sum += a; if (a > peak) peak = a
              }
              console.log('[NoteAI] audio level — avg:', (sum / ch.length).toFixed(5), 'peak:', peak.toFixed(5))
            }

            const out = []
            while (this._pos < ch.length) {
              const v = Math.max(-1, Math.min(1, ch[Math.floor(this._pos)]))
              out.push(v < 0 ? v * 32768 : v * 32767)
              this._pos += this._ratio
            }
            this._pos -= ch.length
            if (out.length === 0) return true
            const i16 = new Int16Array(out)
            this._buf.push(i16)
            this._n += i16.length
            if (this._n >= this._chunkSize) {
              const merged = new Int16Array(this._n)
              let off = 0
              for (const b of this._buf) { merged.set(b, off); off += b.length }
              this.port.postMessage({ samples: Array.from(merged) })
              this._buf = []
              this._n   = 0
            }
            return true
          }
        }
        registerProcessor('zoom-pcm-sender', PCMSender)
      `
      const blob = new Blob([workletCode], { type: 'application/javascript' })
      const url  = URL.createObjectURL(blob)
      await ctx.audioWorklet.addModule(url)
      URL.revokeObjectURL(url)

      // Create a gain node connected between destination and our worklet
      // We use a MediaStreamDestinationNode to tap what flows into destination
      const tapDest   = ctx.createMediaStreamDestination()
      const tapSource = ctx.createMediaStreamSource(tapDest.stream)
      const worklet   = new AudioWorkletNode(ctx, 'zoom-pcm-sender')

      const trackId = 'mixed-' + ctxIndex

      worklet.port.onmessage = (e) => {
        if (window.noteAISendTrackAudio) {
          window.noteAISendTrackAudio(e.data.samples, trackId)
        }
      }

      // Analyser for VAD / speaker detection
      const analyser  = ctx.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.4

      tapSource.connect(worklet)
      tapSource.connect(analyser)
      worklet.connect(ctx.destination)

      // Store analyser for speaker polling
      window.__noteAIAnalyser  = analyser
      window.__noteAIAnalyserData = new Uint8Array(analyser.frequencyBinCount)

      // ── The key: reroute ctx.destination through our tap ────────────────
      // We can't directly intercept ctx.destination (it's read-only), but we
      // can patch createMediaStreamSource / createGain to insert our tap.
      // Instead, we use a ChannelSplitterNode trick:
      // Any node that connects to ctx.destination also connects to tapDest.
      //
      // Patch ctx.createGain, ctx.createMediaStreamSource, etc. to
      // auto-connect to tapDest as well as destination.
      const origConnect = AudioNode.prototype.connect
      AudioNode.prototype.connect = function (target, ...args) {
        const result = origConnect.call(this, target, ...args)
        // If this node is connecting to the main destination, also tap it
        if (target === ctx.destination && this !== worklet && this !== tapSource) {
          try { origConnect.call(this, tapDest, ...args) } catch {}
        }
        return result
      }

      window.__noteAITrackList.push({ trackId, index: ctxIndex - 1 })
      if (window.noteAISendTrackInfo) window.noteAISendTrackInfo(trackId, 'mixed')

      console.log('[NoteAI] AudioContext #' + ctxIndex + ' tap installed ✓ trackId:', trackId)

      // Start speaker detection
      setInterval(checkSpeakers, SPEAKER_POLL_MS)

    } catch (err) {
      console.error('[NoteAI] tapAudioContext failed:', err)
    }
  }

  // ── Speaker detection ────────────────────────────────────────────────────

  const speakingNow = new Map()

  function sendEvent (payload) {
    if (window.noteAISendEvent) window.noteAISendEvent(JSON.stringify(payload))
  }

  function getActiveSpeakerFromDOM () {
    // Zoom highlights the active speaker tile — try multiple selectors
    const selectors = [
      '[class*="speaker-active"] [class*="display-name"]',
      '[class*="active-speaker"] [class*="display-name"]',
      '.speaker-active-container__display-name',
      '[class*="speaking"] [class*="name"]',
    ]
    for (const sel of selectors) {
      const el = document.querySelector(sel)
      const name = el?.textContent?.trim()
      if (name && name.length > 1 && !/^note|recorder/i.test(name)) return name
    }
    return null
  }

  function getParticipantNames () {
  const selectors = [
    '.video-avatar__avatar-name',
    'span.participant-item__display-name',
    '.participants-item__display-name',
    '[class*="participants-item__display-name"]',
    '[class*="participant-item__name"]',
  ]
  const allNames = []
  for (const sel of selectors) {
    for (const el of Array.from(document.querySelectorAll(sel))) {
      const name = (el.textContent || '').replace(/\s*\([^)]*\)\s*$/, '').trim()
      if (name && name.length > 1 && name.length < 60 && !/^note|recorder/i.test(name))
        allNames.push(name)
    }
  }
  return [...new Set(allNames)]
}

  function checkSpeakers () {
    const analyser  = window.__noteAIAnalyser
    const dataArray = window.__noteAIAnalyserData
    if (!analyser || !dataArray) return

    analyser.getByteFrequencyData(dataArray)
    const level = dataArray.reduce((a, b) => a + b, 0) / dataArray.length

    if (level >= SPEAK_THRESHOLD) {
      // Audio is flowing — find who's speaking from DOM
      const activeName = getActiveSpeakerFromDOM()
      if (activeName && !speakingNow.has(activeName)) {
        speakingNow.set(activeName, Date.now())
        sendEvent({ type: 'speaker_start', name: activeName, startMs: Date.now(), meetingId })
      }
    } else {
      // Silence — end all active speakers
      for (const [name] of speakingNow) {
        speakingNow.delete(name)
        sendEvent({ type: 'speaker_end', name, endMs: Date.now(), meetingId })
      }
    }

    // Periodically broadcast known participant names
    if (Math.random() < 0.01) {  // ~1% of polls = every ~30s
      const names = getParticipantNames()
      if (names.length) {
        sendEvent({ type: 'participant_names_snapshot', names, meetingId })
      }
    }
  }

  // ── Wait for Zoom meeting UI then start participant polling ──────────────

  const waitForMeetingUI = setInterval(() => {
    const inMeeting = (
      document.querySelector('.footer-button-base__button') ||
      document.querySelector('[class*="meeting-client"]')   ||
      document.querySelector('.meeting-app')
    )
    if (inMeeting) {
      clearInterval(waitForMeetingUI)
      console.log('[NoteAI] Zoom meeting UI detected — participant polling started')

      // Emit participant snapshot every 5s
      setInterval(() => {
        const names = getParticipantNames()
        if (names.length) {
          names.forEach(name => {
            sendEvent({ type: 'participant_known', name, meetingId })
          })
        }
      }, 5000)
    }
  }, 1500)

  console.log('[NoteAI] audioInjector (Zoom loopback) loaded ✓')

})()