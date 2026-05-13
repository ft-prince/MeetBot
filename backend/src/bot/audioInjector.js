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

    // SSRC fast-path runs every tick of checkSpeakers() until name is locked.
    // No index-based fallback — that was the source of swapped names.
  }

  // ── Name resolution caches ───────────────────────────────────
  // trackNameCache:  trackId → { name, confidence: 'medium' | 'high' }
  //   'medium' = SSRC match (good but DOM may have stale ssrc);
  //   'high'   = co-occurrence confirmed: track was loud AND only one tile was
  //              visibly speaking at the same moment, N times in a row.
  // Once 'high' we never overwrite.
  const trackNameCache = new Map()
  const cooccurrence   = new Map()  // `${trackId}::${tileName}` → count
  const COOCCUR_LOCK   = 3

  function resolveBySSRC (trackId, pc) {
    try {
      const receiver = pc.getReceivers().find(r => r.track.id === trackId)
      const sync = receiver?.getSynchronizationSources?.()
      if (!sync?.length) return null
      const ssrc = String(sync[0].source)
      for (const tile of document.querySelectorAll('[data-participant-id]')) {
        if (tile.querySelector(`[data-ssrc="${ssrc}"]`) ||
            tile.getAttribute('data-ssrc') === ssrc) {
          const n = getName(tile)
          if (n && !/^note|recorder/i.test(n)) return n
        }
      }
    } catch {}
    return null
  }

  function cacheTrackName (trackId, name, confidence) {
    const existing = trackNameCache.get(trackId)
    if (existing && existing.confidence === 'high') return  // never overwrite high
    if (existing && existing.name === name && existing.confidence === confidence) return
    trackNameCache.set(trackId, { name, confidence })
    console.log('[NoteAI] track', trackId.slice(0, 8), '→', name, '(' + confidence + ')')
    if (window.noteAISendTrackInfo) window.noteAISendTrackInfo(trackId, name)
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
      if (e.track.kind === 'video') noteVideoTrack(e.track, pc)
    })
    return pc
  }
  PatchedRTC.prototype = OrigRTC.prototype
  Object.assign(PatchedRTC, OrigRTC)
  window.RTCPeerConnection = PatchedRTC

  // ── Screen-share detection ───────────────────────────────────
  // Two independent signals — emit start when EITHER fires, emit end when both
  // are no longer active. False positives on one signal are filtered by the other.
  //   1. WebRTC: new video track with screen-like profile (large + low fps + screen contentHint)
  //   2. DOM:    Meet shows "X is presenting" text or a presentation tile
  const screenVideoTracks = new Map()   // trackId → { track, label }
  let domPresenterName = null
  let lastEventState = 'inactive'        // 'active' | 'inactive'

  function noteVideoTrack (track, pc) {
    // Heuristic for screen-share video: large frame, low frame rate, or label/contentHint hints.
    // We sample after a brief delay so getSettings() reports real dimensions.
    setTimeout(() => {
      try {
        const settings = track.getSettings ? track.getSettings() : {}
        const label = (track.label || '').toLowerCase()
        const hint  = (track.contentHint || '').toLowerCase()
        const isScreen =
          hint === 'detail' || hint === 'text' ||
          /screen|window|tab|desktop|presentation/.test(label) ||
          (settings.frameRate && settings.frameRate <= 15 && settings.width && settings.width >= 1280)
        if (isScreen) {
          screenVideoTracks.set(track.id, { track, label: track.label || '' })
          updateScreenShareState()
          track.addEventListener('ended', () => {
            screenVideoTracks.delete(track.id)
            updateScreenShareState()
          })
        }
      } catch {}
    }, 1500)
  }

  function detectDomPresenter () {
    // Meet shows "X is presenting" or "You are presenting" somewhere in the UI.
    // We scan a bounded text region for the pattern.
    try {
      const candidates = document.querySelectorAll('[aria-label*="presenting" i], [aria-label*="is sharing" i]')
      for (const el of candidates) {
        const lbl = el.getAttribute('aria-label') || ''
        const m = lbl.match(/(.+?) is (?:presenting|sharing)/i)
        if (m) return m[1].trim()
      }
      const txt = (document.body.innerText || '').slice(0, 5000)
      const m = txt.match(/([^\n]{2,60}?) is presenting/i)
      if (m) return m[1].trim()
      if (/you are presenting/i.test(txt)) return 'You'
      // Also: a presentation tile typically has data-allocation-index="0" and a
      // notably larger bounding box than other tiles. Detect by relative size.
      const tiles = Array.from(document.querySelectorAll('[data-participant-id]'))
      if (tiles.length >= 2) {
        const sized = tiles.map(t => ({ t, area: t.getBoundingClientRect().width * t.getBoundingClientRect().height }))
        sized.sort((a, b) => b.area - a.area)
        if (sized[0].area > sized[1].area * 3) {
          const n = getName(sized[0].t)
          if (n) return n
        }
      }
    } catch {}
    return null
  }

  function updateScreenShareState () {
    const fromTrack = screenVideoTracks.size > 0
    const fromDom = domPresenterName !== null
    const isActive = fromTrack || fromDom
    const presenter = domPresenterName || (fromTrack ? 'Unknown' : null)
    const state = isActive ? 'active' : 'inactive'

    if (state !== lastEventState) {
      lastEventState = state
      if (state === 'active') {
        sendEvent({ type: 'screenshare_start', presenter, sources: { dom: fromDom, track: fromTrack }, startMs: Date.now(), meetingId })
        console.log('[NoteAI] screen-share STARTED', presenter ? 'by ' + presenter : '')
      } else {
        sendEvent({ type: 'screenshare_end', presenter, endMs: Date.now(), meetingId })
        console.log('[NoteAI] screen-share ENDED')
      }
    } else if (state === 'active' && presenter && presenter !== 'Unknown') {
      // State unchanged but presenter name just became known — emit a refinement.
      sendEvent({ type: 'screenshare_update', presenter, ms: Date.now(), meetingId })
    }
  }

  function checkDomPresenter () {
    const next = detectDomPresenter()
    if (next !== domPresenterName) {
      domPresenterName = next
      updateScreenShareState()
    }
  }

  // ── Speaker event emitter ─────────────────────────────────────

  function sendEvent (payload) {
    if (window.noteAISendEvent) window.noteAISendEvent(JSON.stringify(payload))
  }

  // ── DOM speaker activity tracker ─────────────────────────────
  // Records which tiles are currently "speaking" per Meet's own visual signals.
  // We probe each tile for several heuristics; if ANY fires the tile is treated
  // as actively speaking. The mapping logic then correlates this with which
  // audio tracks are loud at the same moment.
  //
  // Signals checked, in rough order of reliability:
  //   1. Active speaker ring/border — tile has class containing "speak"
  //   2. Audio meter SVG/canvas is visible inside tile (has dimensions > 0)
  //   3. aria-label on tile or descendants mentions "speaking" / "talking"
  //   4. The tile's "is-silent"/data-self-silenced attr is false AND tile has
  //      an animated child that's currently rendering (rare false positive)
  //
  // These signals change as Meet updates its UI — we use multiple so a single
  // class rename doesn't break detection.
  function tileIsSpeakingNow (tile) {
    try {
      // Signal 1: any class on tile or descendant containing "speak"
      if (tile.matches('[class*="speak" i]')) return true
      if (tile.querySelector('[class*="speak" i]:not([class*="speaker-name" i])')) return true

      // Signal 2: aria-label hints
      const ariaSpeaking = tile.querySelector('[aria-label*="speaking" i],[aria-label*="talking" i]')
      if (ariaSpeaking) return true

      // Signal 3: animated audio meter — Meet renders a small SVG/canvas that
      // becomes visible only while talking. We look for any small visible svg
      // with class "google-symbols" sibling structure OR canvas inside tile.
      const meter = tile.querySelector('canvas, svg[class*="audio" i], svg[class*="speak" i]')
      if (meter) {
        const r = meter.getBoundingClientRect()
        if (r.width > 4 && r.height > 4) return true
      }
    } catch {}
    return false
  }

  // Walk all remote tiles and return Map<name, tile> for those currently speaking.
  function currentlySpeakingTiles () {
    const out = new Map()
    for (const tile of document.querySelectorAll('[data-participant-id]')) {
      const name = getName(tile)
      if (!name || /^note|recorder/i.test(name)) continue
      if (tileIsSpeakingNow(tile)) out.set(name, tile)
    }
    return out
  }

  // ── Audio-level based speaking detection ─────────────────────

  function checkSpeakers () {
    // Per-track audio levels.
    const loudTracks = []   // [{ trackId, pc }]
    for (const [trackId, { analyser, dataArray, pc }] of trackMeta) {
      analyser.getByteFrequencyData(dataArray)
      const level = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
      if (level >= SPEAK_THRESHOLD) loudTracks.push({ trackId, pc })
    }

    // DOM-side: which tiles are visibly speaking right now?
    const domSpeaking = currentlySpeakingTiles()
    const domNames = [...domSpeaking.keys()]

    // For each loud track, try to bind a name.
    const now = new Set()
    for (const { trackId, pc } of loudTracks) {
      let entry = trackNameCache.get(trackId)

      // (a) SSRC resolution — instantly correct when it works.
      if (!entry || entry.confidence !== 'high') {
        const ssrcName = resolveBySSRC(trackId, pc)
        if (ssrcName) {
          cacheTrackName(trackId, ssrcName, entry?.confidence === 'high' ? 'high' : 'medium')
          entry = trackNameCache.get(trackId)
        }
      }

      // (b) Co-occurrence — if exactly one DOM tile is speaking RIGHT NOW
      //     while this audio track is loud, that's strong evidence of the binding.
      //     Need COOCCUR_LOCK consecutive observations to promote to 'high'.
      if (domNames.length === 1) {
        const candidate = domNames[0]
        const key = trackId + '::' + candidate
        const count = (cooccurrence.get(key) || 0) + 1
        cooccurrence.set(key, count)
        if (count >= COOCCUR_LOCK) {
          cacheTrackName(trackId, candidate, 'high')
          entry = trackNameCache.get(trackId)
        } else if (!entry) {
          // No SSRC match yet — tentatively use the candidate at medium confidence.
          // Will be overwritten if SSRC contradicts, then promoted if it agrees.
          cacheTrackName(trackId, candidate, 'medium')
          entry = trackNameCache.get(trackId)
        }
      }
      // If multiple DOM tiles are speaking (overlap) we don't update co-occurrence
      // for this track — ambiguous moment, wait for solo speech to confirm.

      const name = entry?.name
      if (!name) continue  // emit nothing rather than guess wrong

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
      // Lower frequency — DOM changes for screen-share are not high-rate.
      setInterval(checkDomPresenter, 1000)
    }
  }, 1500)

})()
