// Injected into the Zoom web client by Playwright (runs before Zoom's JS loads).
//
// The modern app.zoom.us client decodes remote audio in a WASM worker and renders
// it through the Web Audio graph (and/or <audio>.srcObject) — it does NOT expose
// remote audio as RTCPeerConnection "track" events the way Google Meet does.
// So we capture the rendered MIX from three places (whichever Zoom actually uses):
//   1. AudioNode.connect(...destination)  → tap the Web Audio output  (WASM client)
//   2. HTMLMediaElement.srcObject setter  → tap <audio> playback       (some builds)
//   3. RTCPeerConnection 'track' events   → legacy zoom.us/wc client   (fallback)
//
// Zoom often exposes MORE than one playback context (e.g. voice + screen-share),
// so we collect all taps as candidates and forward only the ONE with real voice
// energy. Forwarding two streams into a single Deepgram socket interleaves them
// and corrupts/slows transcription.
//
// The chosen stream is downsampled to 16 kHz mono PCM and sent as one mixed
// stream via window.noteAISendTrackAudio(samples, 'zoom-mixed'). The backend
// routes it through Deepgram (diarize:true) + the SpeakerCorrelator, which maps
// SPEAKER_0/1/2 to real names using the DOM speaker_start/end events below.

;(function () {
  const SAMPLE_RATE = 16000
  const CHUNK_SAMPLES = SAMPLE_RATE * 0.15 // 150 ms
  const MIX_TRACK_ID = 'zoom-mixed'
  const ENERGY_THRESHOLD = 6 // avg byte level that counts as "has audio"
  const SELECT_FALLBACK_MS = 2500 // if nothing is clearly loud, use the first tap

  let captureCtx = null
  const seenTrackIds = new Set()
  const candidates = new Map() // trackId → { source, analyser, data }
  let activeTrackId = null
  let firstSeenAt = 0

  function ensureCaptureCtx () {
    if (!captureCtx) {
      captureCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE })
    }
    return captureCtx
  }

  // ── AudioWorklet (preferred, off main thread) with ScriptProcessor fallback ──

  let workletReady = null
  function initWorklet (ctx) {
    if (workletReady) return workletReady
    workletReady = (async () => {
      const code = `
        class PCMSender extends AudioWorkletProcessor {
          constructor () { super(); this._buf = []; this._n = 0 }
          process (inputs) {
            const ch = inputs[0] && inputs[0][0]; if (!ch) return true
            const i16 = new Int16Array(ch.length)
            for (let i = 0; i < ch.length; i++) {
              const v = Math.max(-1, Math.min(1, ch[i]))
              i16[i] = v < 0 ? v * 32768 : v * 32767
            }
            this._buf.push(i16); this._n += i16.length
            if (this._n >= ${CHUNK_SAMPLES}) {
              const out = new Int16Array(this._n); let off = 0
              for (const b of this._buf) { out.set(b, off); off += b.length }
              this.port.postMessage(out, [out.buffer]); this._buf = []; this._n = 0
            }
            return true
          }
        }
        registerProcessor('pcm-sender', PCMSender)
      `
      const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }))
      try {
        await ctx.audioWorklet.addModule(url)
        console.log('[NoteAI] using AudioWorklet capture')
        return true
      } catch (e) {
        console.log('[NoteAI] AudioWorklet blocked, using ScriptProcessor:', e && e.message)
        return false
      } finally {
        URL.revokeObjectURL(url)
      }
    })()
    return workletReady
  }

  // Build the forwarding pipeline on the chosen candidate's source node.
  async function startForwarding (source) {
    const ctx = captureCtx
    const ok = await initWorklet(ctx)

    if (ok) {
      const node = new AudioWorkletNode(ctx, 'pcm-sender')
      node.port.onmessage = (e) => {
        if (window.noteAISendTrackAudio) window.noteAISendTrackAudio(Array.from(new Int16Array(e.data)), MIX_TRACK_ID)
      }
      source.connect(node) // worklet needs no destination connection
      return
    }

    // ScriptProcessor fallback (must connect to a muted destination to run)
    const proc = ctx.createScriptProcessor(2048, 1, 1)
    let buf = []
    let n = 0
    proc.onaudioprocess = (e) => {
      const ch = e.inputBuffer.getChannelData(0)
      const i16 = new Int16Array(ch.length)
      for (let i = 0; i < ch.length; i++) {
        const v = Math.max(-1, Math.min(1, ch[i]))
        i16[i] = v < 0 ? v * 32768 : v * 32767
      }
      buf.push(i16); n += i16.length
      if (n >= CHUNK_SAMPLES) {
        const out = new Int16Array(n); let off = 0
        for (const b of buf) { out.set(b, off); off += b.length }
        if (window.noteAISendTrackAudio) window.noteAISendTrackAudio(Array.from(out), MIX_TRACK_ID)
        buf = []; n = 0
      }
    }
    const mute = ctx.createGain()
    mute.gain.value = 0
    source.connect(proc); proc.connect(mute); mute.connect(ctx.destination)
  }

  // Register a tapped audio track as a candidate (with an analyser for energy).
  function captureTrack (track, sourceLabel) {
    try {
      if (!track || track.kind !== 'audio' || seenTrackIds.has(track.id)) return
      seenTrackIds.add(track.id)
      console.log('[NoteAI] candidate Zoom audio track via ' + sourceLabel + ':', track.id.slice(0, 8))

      const ctx = ensureCaptureCtx()
      const source = ctx.createMediaStreamSource(new MediaStream([track]))
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      candidates.set(track.id, { source, analyser, data: new Uint8Array(analyser.frequencyBinCount) })
      if (!firstSeenAt) firstSeenAt = Date.now()
    } catch (err) {
      console.log('[NoteAI] captureTrack error:', err && err.message)
    }
  }

  // Pick exactly one candidate to forward: the loudest one, or — if nothing is
  // clearly loud after a short grace period — the first tap we saw.
  function selectActive () {
    if (activeTrackId || candidates.size === 0) return

    let bestId = null
    let bestLevel = 0
    for (const [id, c] of candidates) {
      c.analyser.getByteFrequencyData(c.data)
      let sum = 0
      for (let i = 0; i < c.data.length; i++) sum += c.data[i]
      const level = sum / c.data.length
      if (level > bestLevel) { bestLevel = level; bestId = id }
    }

    const graceElapsed = firstSeenAt && Date.now() - firstSeenAt > SELECT_FALLBACK_MS
    if (bestId && (bestLevel >= ENERGY_THRESHOLD || graceElapsed)) {
      activeTrackId = bestId
      const chosen = candidates.get(bestId)
      console.log('[NoteAI] forwarding Zoom audio from', bestId.slice(0, 8), '(level', bestLevel.toFixed(1) + ')')
      startForwarding(chosen.source)
    }
  }

  // ── Path 1: tap the Web Audio output (WASM client) ───────────────────────────
  try {
    const origConnect = AudioNode.prototype.connect
    AudioNode.prototype.connect = function (target) {
      try {
        const ctx = this.context
        const isDestination =
          (typeof AudioDestinationNode !== 'undefined' && target instanceof AudioDestinationNode) ||
          (ctx && target === ctx.destination)
        if (isDestination && ctx && typeof ctx.createMediaStreamDestination === 'function') {
          if (!ctx.__noteAITap) {
            ctx.__noteAITap = ctx.createMediaStreamDestination()
            const t = ctx.__noteAITap.stream.getAudioTracks()[0]
            if (t) captureTrack(t, 'audiocontext')
          }
          try { origConnect.call(this, ctx.__noteAITap) } catch {}
        }
      } catch {}
      return origConnect.apply(this, arguments)
    }
  } catch {}

  // ── Path 2: tap <audio>.srcObject playback ───────────────────────────────────
  try {
    const proto = HTMLMediaElement.prototype
    const desc = Object.getOwnPropertyDescriptor(proto, 'srcObject')
    if (desc && desc.set && desc.configurable) {
      Object.defineProperty(proto, 'srcObject', {
        configurable: true,
        enumerable: desc.enumerable,
        get: desc.get,
        set: function (stream) {
          try {
            if (stream && typeof stream.getAudioTracks === 'function') {
              for (const t of stream.getAudioTracks()) captureTrack(t, 'srcObject')
            }
          } catch {}
          return desc.set.call(this, stream)
        },
      })
    }
  } catch {}

  // ── Path 3: legacy RTCPeerConnection track events (fallback) ──────────────────
  try {
    if (typeof window.RTCPeerConnection !== 'undefined') {
      const OrigRTC = window.RTCPeerConnection
      function applyPatch () {
        function PatchedRTC () {
          const pc = new OrigRTC(...arguments)
          pc.addEventListener('track', function (e) {
            if (e.track && e.track.kind === 'audio') captureTrack(e.track, 'rtc')
          })
          return pc
        }
        PatchedRTC.prototype = OrigRTC.prototype
        Object.assign(PatchedRTC, OrigRTC)
        PatchedRTC.__noteAIPatched = true
        window.RTCPeerConnection = PatchedRTC
      }
      applyPatch()
      setInterval(function () {
        if (!window.RTCPeerConnection.__noteAIPatched) applyPatch()
      }, 500)
    }
  } catch {}

  // Run the candidate selector until one stream is chosen.
  setInterval(selectActive, 250)

  // ── DOM active-speaker → speaker_start / speaker_end events ───────────────────

  function cleanName (raw) {
    let name = (raw || '').trim()
    // Strip trailing status text Zoom appends, e.g. "PRINCE S, unmuted, speaking"
    name = name.replace(/,\s*(unmuted|muted|speaking|host|co-host|guest).*$/i, '').trim()
    // Collapse doubled rendering, e.g. "PRINCE SPRINCE S" → "PRINCE S"
    if (name.length >= 4 && name.length % 2 === 0) {
      const half = name.length / 2
      if (name.slice(0, half) === name.slice(half)) name = name.slice(0, half)
    }
    if (!name || name.length < 2 || /^note|recorder/i.test(name)) return null
    return name
  }

  // The big "active speaker" tile reflects whoever is currently talking
  // (Zoom switches it automatically). The thumbnail speaker-bar is the bot's own
  // tile, so it is intentionally NOT used here.
  function getZoomActiveSpeaker () {
    const selectors = [
      '.speaker-active-container__video-frame',
      '.speaker-active-container__wrap',
      '[class*="speaker-active-container"] [class*="avatar-name"]',
      '[class*="active-speaker"] [class*="name"]',
    ]
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel)
        if (el) {
          const name = cleanName(el.textContent || el.getAttribute('aria-label'))
          if (name) return name
        }
      } catch {}
    }
    return null
  }

  function sendEvent (payload) {
    if (window.noteAISendEvent) window.noteAISendEvent(JSON.stringify(payload))
  }

  let lastSpeaker = null
  function pollActiveSpeaker () {
    let name = null
    try { name = getZoomActiveSpeaker() } catch {}
    if (name === lastSpeaker) return
    if (lastSpeaker) sendEvent({ type: 'speaker_end', name: lastSpeaker, endMs: Date.now() })
    if (name) { sendEvent({ type: 'speaker_start', name, startMs: Date.now() }); console.log('[NoteAI] active speaker:', name) }
    lastSpeaker = name
  }

  setTimeout(function () {
    console.log('[NoteAI] Zoom speaker polling started')
    setInterval(pollActiveSpeaker, 300)
  }, 5000)
})()
