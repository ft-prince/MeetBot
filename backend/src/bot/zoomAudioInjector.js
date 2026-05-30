// Injected into the Zoom web client by Playwright (runs before Zoom's JS loads).
//
// Zoom has TWO very different audio delivery paths depending on the account
// tier / server (us04 vs us05) and the deployed client build:
//
//   A) Legacy WebRTC (often us04, free tier):
//      Each remote participant arrives as its own RTCPeerConnection audio track —
//      exactly like Google Meet. Capturing only one track loses everyone else.
//
//   B) Modern WASM client (often us05, paid):
//      Remote audio is decoded in a worker and rendered through the Web Audio
//      graph (AudioNode → destination) or an <audio>.srcObject. There is no
//      per-participant track at all — only one mixed playback stream.
//
// We support BOTH:
//   • For path A (`rtc`)  → forward every track independently with its own id.
//     Per-track names come from DOM co-occurrence (loud track + DOM active
//     speaker → bind trackId → name) and flow via noteAISendTrackInfo.
//   • For path B (`audiocontext`/`srcObject`) → collect taps as candidates,
//     pick the one with real voice energy, forward ONE mixed stream
//     (trackId = 'zoom-mixed'). The backend tags each segment with the live
//     active-speaker from the DOM.
//
// Bridges exposed by zoomBot.ts:
//   window.noteAISendTrackAudio(samples, trackId)
//   window.noteAISendTrackInfo (trackId, name)
//   window.noteAISendEvent     (json)

;(function () {
  const SAMPLE_RATE = 16000
  const CHUNK_SAMPLES = SAMPLE_RATE * 0.15
  const MIX_TRACK_ID = 'zoom-mixed'
  const ENERGY_THRESHOLD = 6
  const SELECT_FALLBACK_MS = 2500
  const COOCCUR_LOCK = 3
  const LOUD_THRESHOLD_RTC = 8

  let captureCtx = null
  const seenTrackIds = new Set()

  // Path A — per-participant RTC tracks
  const rtcTracks = new Map() // trackId → { source, analyser, data }
  const trackName = new Map() // trackId → { name, locked: true }
  const cooccur = new Map()   // "<trackId>::<name>" → consecutive matches

  // Path B — mixed-stream candidates (audiocontext / srcObject)
  const mixCandidates = new Map() // trackId → { source, analyser, data }
  let mixActive = null
  let mixFirstSeenAt = 0

  function ensureCaptureCtx () {
    if (!captureCtx) {
      captureCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE })
    }
    return captureCtx
  }

  // ── AudioWorklet (preferred) with ScriptProcessor fallback ────────────────
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

  // Build a PCM pipeline on `source` that posts chunks tagged with `trackId`.
  async function startForwarding (source, trackId) {
    const ctx = captureCtx
    const ok = await initWorklet(ctx)
    if (ok) {
      const node = new AudioWorkletNode(ctx, 'pcm-sender')
      node.port.onmessage = (e) => {
        if (window.noteAISendTrackAudio) window.noteAISendTrackAudio(Array.from(new Int16Array(e.data)), trackId)
      }
      source.connect(node)
      return
    }
    const proc = ctx.createScriptProcessor(2048, 1, 1)
    let buf = [], n = 0
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
        if (window.noteAISendTrackAudio) window.noteAISendTrackAudio(Array.from(out), trackId)
        buf = []; n = 0
      }
    }
    const mute = ctx.createGain(); mute.gain.value = 0
    source.connect(proc); proc.connect(mute); mute.connect(ctx.destination)
  }

  // ── captureTrack: dispatches into the path that matches the source ────────
  function captureTrack (track, sourceLabel) {
    try {
      if (!track || track.kind !== 'audio' || seenTrackIds.has(track.id)) return
      seenTrackIds.add(track.id)

      const ctx = ensureCaptureCtx()
      const source = ctx.createMediaStreamSource(new MediaStream([track]))
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      const slot = { source, analyser, data: new Uint8Array(analyser.frequencyBinCount) }

      if (sourceLabel === 'rtc') {
        // Per-participant track — forward each independently (Meet model).
        rtcTracks.set(track.id, slot)
        console.log('[NoteAI] RTC participant track:', track.id.slice(0, 8))
        startForwarding(source, track.id)
      } else {
        // Mixed-stream tap — one will be chosen by energy after a short window.
        mixCandidates.set(track.id, slot)
        if (!mixFirstSeenAt) mixFirstSeenAt = Date.now()
        console.log('[NoteAI] candidate Zoom audio track via ' + sourceLabel + ':', track.id.slice(0, 8))
      }
    } catch (err) {
      console.log('[NoteAI] captureTrack error:', err && err.message)
    }
  }

  // Energy-pick one mixed candidate (only when there are NO RTC tracks — they
  // already carry all participants and we must not double-transcribe).
  function selectMixActive () {
    if (mixActive || mixCandidates.size === 0) return
    if (rtcTracks.size > 0) return

    let bestId = null, bestLevel = 0
    for (const [id, c] of mixCandidates) {
      c.analyser.getByteFrequencyData(c.data)
      let sum = 0
      for (let i = 0; i < c.data.length; i++) sum += c.data[i]
      const level = sum / c.data.length
      if (level > bestLevel) { bestLevel = level; bestId = id }
    }
    const elapsed = mixFirstSeenAt && Date.now() - mixFirstSeenAt > SELECT_FALLBACK_MS
    if (bestId && (bestLevel >= ENERGY_THRESHOLD || elapsed)) {
      mixActive = bestId
      const c = mixCandidates.get(bestId)
      console.log('[NoteAI] forwarding Zoom audio (mixed) from', bestId.slice(0, 8), '(level', bestLevel.toFixed(1) + ')')
      startForwarding(c.source, MIX_TRACK_ID)
    }
  }

  // Per-RTC-track co-occurrence: when exactly ONE track is loud while the DOM
  // shows active speaker = X for several consecutive samples, bind that track
  // to X and tell the backend (noteAISendTrackInfo). Locked tracks stay bound.
  function pollRtcCooccurrence () {
    if (rtcTracks.size === 0) return
    const loud = []
    for (const [id, t] of rtcTracks) {
      t.analyser.getByteFrequencyData(t.data)
      let sum = 0
      for (let i = 0; i < t.data.length; i++) sum += t.data[i]
      const level = sum / t.data.length
      if (level >= LOUD_THRESHOLD_RTC) loud.push(id)
    }
    if (loud.length !== 1) return
    const trackId = loud[0]
    if (trackName.get(trackId)?.locked) return
    const name = getZoomActiveSpeaker()
    if (!name) return
    const key = trackId + '::' + name
    const c = (cooccur.get(key) || 0) + 1
    cooccur.set(key, c)
    if (c >= COOCCUR_LOCK) {
      trackName.set(trackId, { name, locked: true })
      console.log('[NoteAI] track', trackId.slice(0, 8), '→', name, '(co-occurrence)')
      if (window.noteAISendTrackInfo) window.noteAISendTrackInfo(trackId, name)
    }
  }

  // ── Path 1: Web Audio output tap (WASM client) ────────────────────────────
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

  // ── Path 2: <audio>.srcObject ─────────────────────────────────────────────
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

  // ── Path 3: legacy RTCPeerConnection per-participant tracks ───────────────
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

  setInterval(selectMixActive, 250)
  setInterval(pollRtcCooccurrence, 300)

  // ── DOM active-speaker → speaker_start / speaker_end ──────────────────────
  function cleanName (raw) {
    let name = (raw || '').trim()
    name = name.replace(/,\s*(unmuted|muted|speaking|host|co-host|guest).*$/i, '').trim()
    if (name.length >= 4 && name.length % 2 === 0) {
      const half = name.length / 2
      if (name.slice(0, half) === name.slice(half)) name = name.slice(0, half)
    }
    if (!name || name.length < 2 || /^note|recorder/i.test(name)) return null
    return name
  }

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