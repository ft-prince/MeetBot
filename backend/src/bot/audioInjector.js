// Injected into Google Meet by Playwright (runs before Meet's JS loads)
// Sends per-participant audio tracks separately so each person gets their own transcription.
// window.noteAISendTrackAudio(samples, trackId) — PCM for one track
// window.noteAISendTrackInfo(trackId, name)     — maps trackId to participant name
// window.noteAISendEvent(json)                  — speaker_start / speaker_end

;(function () {
  const SAMPLE_RATE   = 16000
  const CHUNK_SAMPLES = SAMPLE_RATE * 0.2  // 200ms

  let audioCtx = null
  let audioInitPromise = null   // ensures initAudio() is only called once
  const connectedTracks = new Set()
  const trackMeta = new Map()  // trackId → { analyser, dataArray, index }
  let trackIndex = 0
  const speakingNow = new Map()
  const SPEAK_THRESHOLD = 8   // 0-255 average frequency energy

  // Exposed to page.evaluate so pollParticipantNames can resolve track→name
  window.__noteAITrackList = []   // [{trackId, index}]

  const meetingId = (function () {
    const m = location.pathname.match(/\/([a-z]{3}-[a-z]{4}-[a-z]{3})/)
    return m ? m[1] : `bot-${Date.now()}`
  })()

  // ── Audio pipeline init ───────────────────────────────────────

  async function initAudio () {
    audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE })

    const workletCode = `
      class PCMSender extends AudioWorkletProcessor {
        constructor () { super(); this._buf = []; this._n = 0 }
        process (inputs) {
          const ch = inputs[0]?.[0]; if (!ch) return true
          const i16 = new Int16Array(ch.length)
          for (let i = 0; i < ch.length; i++) {
            const v = Math.max(-1, Math.min(1, ch[i]))
            i16[i] = v < 0 ? v * 32768 : v * 32767
          }
          this._buf.push(i16); this._n += i16.length
          if (this._n >= ${CHUNK_SAMPLES}) {
            const out = new Int16Array(this._n)
            let off = 0
            for (const b of this._buf) { out.set(b, off); off += b.length }
            this.port.postMessage({ samples: Array.from(out), trackId: this._trackId })
            this._buf = []; this._n = 0
          }
          return true
        }
      }
      registerProcessor('pcm-sender', PCMSender)
    `
    const blob = new Blob([workletCode], { type: 'application/javascript' })
    const url  = URL.createObjectURL(blob)
    await audioCtx.audioWorklet.addModule(url)
    URL.revokeObjectURL(url)
    console.log('[NoteAI] audio context ready')
  }

  async function addAudioTrack (track, pc) {
    if (connectedTracks.has(track.id)) return
    connectedTracks.add(track.id)
    const trackId  = track.id
    const myIndex  = trackIndex++
    console.log('[NoteAI] new audio track:', trackId.slice(0, 8), 'index:', myIndex)
    window.__noteAITrackList.push({ trackId, index: myIndex })

    // Singleton init — all concurrent calls share the same promise
    if (!audioInitPromise) audioInitPromise = initAudio()
    await audioInitPromise

    const source   = audioCtx.createMediaStreamSource(new MediaStream([track]))

    // Per-track worklet — sends audio for this one participant
    const worklet  = new AudioWorkletNode(audioCtx, 'pcm-sender')
    worklet.port.onmessage = (e) => {
      if (window.noteAISendTrackAudio) window.noteAISendTrackAudio(e.data.samples, trackId)
    }

    // Per-track analyser — measures audio level for speaking detection
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.4
    const dataArray = new Uint8Array(analyser.frequencyBinCount)

    source.connect(worklet)
    source.connect(analyser)

    trackMeta.set(trackId, { analyser, dataArray, index: myIndex, pc })

    // Try to resolve participant name after DOM has settled
    setTimeout(() => resolveTrackName(trackId, pc, myIndex), 2500)
    setTimeout(() => resolveTrackName(trackId, pc, myIndex), 6000)
  }

  // ── Name resolution: track → participant ─────────────────────

  function resolveTrackName (trackId, pc, index) {
    let name = null

    // Strategy 1: SSRC → data-ssrc tile
    try {
      const receiver = pc.getReceivers().find(r => r.track.id === trackId)
      const sync = receiver?.getSynchronizationSources?.()
      if (sync?.length) {
        const ssrc = sync[0].source
        for (const tile of document.querySelectorAll('[data-participant-id]')) {
          if (tile.querySelector(`[data-ssrc="${ssrc}"]`) ||
              tile.getAttribute('data-ssrc') === String(ssrc)) {
            const n = getName(tile)
            if (n) { name = n; break }
          }
        }
      }
    } catch {}

    // Strategy 2: button-only tiles = only remote participants (self-view excluded)
    if (!name) {
      const remoteNames = Array.from(document.querySelectorAll('[data-participant-id]'))
        .map(tile => {
          for (const btn of tile.querySelectorAll('button[aria-label]')) {
            const m = (btn.getAttribute('aria-label') || '').match(/^More options for (.+)$/i)
            if (m) return m[1].trim()
          }
          return null
        })
        .filter(n => n && !/^note|recorder/i.test(n))
      if (remoteNames[index]) name = remoteNames[index]
    }

    if (name && !/^note|recorder/i.test(name)) {
      console.log('[NoteAI] track', trackId.slice(0, 8), '→', name)
      if (window.noteAISendTrackInfo) window.noteAISendTrackInfo(trackId, name)
    }
  }

  // ── Name extraction from a tile ──────────────────────────────

  function getName (tile) {
    // "More options for <name>" button (visible on hover)
    for (const btn of tile.querySelectorAll('button[aria-label]')) {
      const m = (btn.getAttribute('aria-label') || '').match(/^More options for (.+)$/i)
      if (m) return m[1].trim()
    }
    // Data attributes
    const d = tile.getAttribute('data-self-name') || tile.getAttribute('data-participant-name')
    if (d) return d.trim()
    // Text content repeats name twice: "PRINCE SPRINCE Sdevices" → "PRINCE S"
    const raw = (tile.textContent || '').replace(/\s+/g, ' ').trim()
    const clean = raw.replace(/\s*devices\s*$/i, '').trim()
    const m2 = clean.match(/^(.{2,40})\1/)
    if (m2) return m2[1].trim()
    return null
  }

  // ── RTCPeerConnection patch ───────────────────────────────────

  const OrigRTC = window.RTCPeerConnection
  function PatchedRTC (...args) {
    const pc = new OrigRTC(...args)
    pc.addEventListener('track', (e) => {
      if (e.track.kind === 'audio') addAudioTrack(e.track, pc).catch(() => {})
    })
    return pc
  }
  PatchedRTC.prototype = OrigRTC.prototype
  Object.assign(PatchedRTC, OrigRTC)
  window.RTCPeerConnection = PatchedRTC

  // ── Speaker event emitter ─────────────────────────────────────

  function sendEvent (payload) {
    if (window.noteAISendEvent) window.noteAISendEvent(JSON.stringify(payload))
  }

  // ── Audio-level based speaking detection ─────────────────────

  function checkSpeakers () {
    // Only button-revealed tiles = real remote participants (self-view has no such button)
    const remoteTileNames = Array.from(document.querySelectorAll('[data-participant-id]'))
      .map(tile => {
        for (const btn of tile.querySelectorAll('button[aria-label]')) {
          const m = (btn.getAttribute('aria-label') || '').match(/^More options for (.+)$/i)
          if (m) return m[1].trim()
        }
        return null
      })
      .filter(n => n && !/^note|recorder/i.test(n))

    const now = new Set()

    for (const [trackId, { analyser, dataArray, index }] of trackMeta) {
      analyser.getByteFrequencyData(dataArray)
      const level = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
      if (level < SPEAK_THRESHOLD) continue

      const name = remoteTileNames[index] || null
      if (!name) continue

      now.add(name)
      if (!speakingNow.has(name)) {
        speakingNow.set(name, Date.now())
        sendEvent({ type: 'speaker_start', name, startMs: Date.now(), meetingId })
      }
    }

    for (const [name] of speakingNow) {
      if (!now.has(name)) {
        speakingNow.delete(name)
        sendEvent({ type: 'speaker_end', name, endMs: Date.now(), meetingId })
      }
    }
  }

  // ── Wait for Meet UI then start polling ───────────────────────
  // [data-participant-id] exists on the pre-join screen (own camera preview), so we
  // require [data-ssrc] which is only set on tiles once inside the actual meeting.

  const waitUI = setInterval(() => {
    const inMeeting = document.querySelector('[data-ssrc],[data-call-ended]')
    if (inMeeting) {
      clearInterval(waitUI)
      console.log('[NoteAI] Meet UI detected — speaker polling started')
      setInterval(checkSpeakers, 300)
    }
  }, 1500)

})()
