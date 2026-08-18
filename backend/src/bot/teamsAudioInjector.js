// Injected into the Microsoft Teams web client by Playwright (runs before Teams' JS loads).
//
// Teams web delivers remote audio over WebRTC. Depending on the build it is either:
//
//   A) Per-participant RTC tracks (rare on web, common when SFU forwards):
//      each remote participant arrives as its own RTCPeerConnection audio track.
//      We forward each independently and bind names via DOM co-occurrence.
//
//   B) A single mixed remote stream (most common on the Teams web client):
//      one decoded audio stream rendered through the Web Audio graph or an
//      <audio>.srcObject. There is no per-participant track.
//
//      When Teams live captions are enabled, we use caption-driven routing:
//        1. Audio is buffered in a sliding ring buffer (MAX_QUEUE_AGE_MS).
//        2. Caption DOM (`[data-tid="author"]`) identifies who is speaking.
//        3. On speaker change: recent audio (last 2 s) is flushed to the new
//           speaker's virtual track, absorbing the caption delay gap.
//        4. On text growth: buffered chunks are flushed to the current speaker.
//        5. Each unique speaker name becomes its own virtual trackId, giving
//           the backend a dedicated Deepgram stream per participant.
//      When captions are NOT enabled or not yet seen, we fall back to sending
//      as 'teams-mixed' with DOM active-speaker events (existing behaviour).
//
// Bridges exposed by teamsBot.ts (and wsBridge.ts in the Docker bot):
//   window.noteAISendTrackAudio(samples, trackId)
//   window.noteAISendTrackInfo (trackId, name)
//   window.noteAISendEvent     (json)

;(function () {
  const SAMPLE_RATE = 16000
  const CHUNK_SAMPLES = SAMPLE_RATE * 0.15   // 150 ms chunks
  const MIX_TRACK_ID = 'teams-mixed'
  const ENERGY_THRESHOLD = 6
  const SELECT_FALLBACK_MS = 2500
  const COOCCUR_LOCK = 3
  const LOUD_THRESHOLD_RTC = 8

  // Caption routing constants (mirrors Vexa recording.ts approach)
  const MAX_QUEUE_AGE_MS = 10000   // keep up to 10 s of audio
  const CAPTION_LOOKBACK_MS = 2000 // flush this much history on speaker change
  const MIN_TEXT_GROWTH = 3        // ignore refinements smaller than this

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

  // ── Caption-driven per-speaker routing ─────────────────────────────────────
  // audioQueue holds Int16Array chunks (already format-converted) waiting to be
  // routed to the correct speaker. Cleared/flushed on caption events.
  const audioQueue = []  // { samples: number[], ts: number }
  let captionMode = false         // true once first caption is detected
  let lastCaptionSpeaker = null   // speaker name from last processed caption
  let lastFlushedTextLen = 0      // to detect new words vs. punctuation edits

  function queueChunk (samples) {
    const now = Date.now()
    audioQueue.push({ samples, ts: now })
    // Prune entries older than MAX_QUEUE_AGE_MS
    while (audioQueue.length > 0 && now - audioQueue[0].ts > MAX_QUEUE_AGE_MS) {
      audioQueue.shift()
    }
  }

  function flushQueue (speaker) {
    let flushed = 0
    while (audioQueue.length > 0) {
      const c = audioQueue.shift()
      if (window.noteAISendTrackAudio) window.noteAISendTrackAudio(c.samples, speaker)
      flushed++
    }
    return flushed
  }

  // Decides where to send a mixed-stream chunk.
  // RTC tracks bypass this entirely (they have their own named forwarding).
  function routeMixedChunk (samples) {
    queueChunk(samples)

    if (captionMode && lastCaptionSpeaker) {
      // Caption mode: flush is driven by processCaptions(); don't double-send.
      // Audio accumulates in the queue until a caption event drains it.
      return
    }

    // Fallback (no captions yet): send immediately as the mixed stream so the
    // backend keeps transcribing with DOM-based speaker attribution.
    if (window.noteAISendTrackAudio) window.noteAISendTrackAudio(samples, MIX_TRACK_ID)
  }

  // ── Caption DOM observation ─────────────────────────────────────────────────
  const CAPTION_WRAPPER_SEL  = '[data-tid="closed-caption-renderer-wrapper"]'
  const CAPTION_AUTHOR_SEL   = '[data-tid="author"]'
  const CAPTION_TEXT_SEL     = '[data-tid="closed-caption-text"]'

  let lastCaptionKey = ''

  function processCaptions () {
    const wrapper = document.querySelector(CAPTION_WRAPPER_SEL)
    if (!wrapper) return

    const authors = wrapper.querySelectorAll(CAPTION_AUTHOR_SEL)
    const texts   = wrapper.querySelectorAll(CAPTION_TEXT_SEL)
    if (!authors.length || !texts.length) return

    // Use the LAST pair — most recent caption entry (host/guest have different DOM
    // nesting but author + text stable atoms are always paired by document order).
    const speaker = (authors[authors.length - 1].textContent || '').trim()
    const text    = (texts[texts.length - 1].textContent || '').trim()
    if (!speaker || !text) return

    // Skip the bot's own speech
    // Drop our own bot's captions. Matches on "recorder" alone so the filter
    // survives display-name rebrands (NoteAI Recorder → MeetMaster Recorder).
    if (/recorder/i.test(speaker)) return

    const key = speaker + '::' + text
    if (key === lastCaptionKey) return
    lastCaptionKey = key

    const now = Date.now()

    if (speaker !== lastCaptionSpeaker) {
      // Speaker changed. Discard audio older than CAPTION_LOOKBACK_MS (stale
      // silence / previous speaker's tail), then flush recent lookback to the
      // new speaker so their opening words are not lost to the caption delay.
      captionMode = true
      lastFlushedTextLen = 0

      const cutoff = now - CAPTION_LOOKBACK_MS
      let discarded = 0
      while (audioQueue.length > 0 && audioQueue[0].ts < cutoff) {
        audioQueue.shift(); discarded++
      }
      const flushed = flushQueue(speaker)
      console.log('[NoteAI] Teams caption → ' + speaker +
        ' (flushed ' + flushed + ', discarded ' + discarded + ')')

      // Register the speaker name so the backend creates a dedicated Deepgram
      // stream and attributes transcripts correctly.
      if (window.noteAISendTrackInfo) window.noteAISendTrackInfo(speaker, speaker)
      lastCaptionSpeaker = speaker
      return
    }

    // Same speaker — flush when text has grown by new words (not just edits).
    const growth = text.length - lastFlushedTextLen
    if (growth > MIN_TEXT_GROWTH || text.length < lastFlushedTextLen) {
      if (audioQueue.length > 0) {
        flushQueue(speaker)
      }
      lastFlushedTextLen = text.length
    }
  }

  function startCaptionObserver () {
    const wrapper = document.querySelector(CAPTION_WRAPPER_SEL)
    if (!wrapper) return false
    console.log('[NoteAI] Teams caption wrapper found — caption-driven routing ACTIVE')
    const obs = new MutationObserver(processCaptions)
    obs.observe(wrapper, { childList: true, subtree: true, characterData: true })
    // Backup poll — catches virtual-DOM updates that bypass MutationObserver.
    setInterval(processCaptions, 200)
    return true
  }

  // Poll until the caption container appears (user must enable captions in Teams).
  const captionDetectInterval = setInterval(() => {
    if (startCaptionObserver()) clearInterval(captionDetectInterval)
  }, 2000)

  // Also watch body for the wrapper to be inserted.
  const captionBodyWatcher = new MutationObserver(() => {
    if (captionMode || startCaptionObserver()) {
      captionBodyWatcher.disconnect()
      clearInterval(captionDetectInterval)
    }
  })
  // This file is injected via addInitScript, which runs at document-start —
  // <body> does not exist yet. Observing null throws, and the throw aborts the
  // rest of this module, so audio capture below never registers. Wait for the
  // document to have a body before observing.
  function watchBodyForCaptions () {
    if (document.body) {
      captionBodyWatcher.observe(document.body, { childList: true, subtree: true })
      return
    }
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        if (document.body) captionBodyWatcher.observe(document.body, { childList: true, subtree: true })
      },
      { once: true }
    )
  }
  watchBodyForCaptions()

  // ── AudioWorklet + ScriptProcessor forwarding ───────────────────────────────
  function ensureCaptureCtx () {
    if (!captureCtx) {
      captureCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE })
    }
    return captureCtx
  }

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

  async function startForwarding (source, trackId) {
    const ctx = captureCtx
    const isMix = trackId === MIX_TRACK_ID
    const ok = await initWorklet(ctx)

    if (ok) {
      const node = new AudioWorkletNode(ctx, 'pcm-sender')
      node.port.onmessage = (e) => {
        const samples = Array.from(new Int16Array(e.data))
        if (isMix) {
          routeMixedChunk(samples)
        } else {
          if (window.noteAISendTrackAudio) window.noteAISendTrackAudio(samples, trackId)
        }
      }
      source.connect(node)
      return
    }

    // ScriptProcessor fallback
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
        const samples = Array.from(out)
        if (isMix) {
          routeMixedChunk(samples)
        } else {
          if (window.noteAISendTrackAudio) window.noteAISendTrackAudio(samples, trackId)
        }
        buf = []; n = 0
      }
    }
    const mute = ctx.createGain(); mute.gain.value = 0
    source.connect(proc); proc.connect(mute); mute.connect(ctx.destination)
  }

  // ── captureTrack: dispatches into the path that matches the source ──────────
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
        rtcTracks.set(track.id, slot)
        console.log('[NoteAI] RTC participant track:', track.id.slice(0, 8))
        startForwarding(source, track.id)
      } else {
        mixCandidates.set(track.id, slot)
        if (!mixFirstSeenAt) mixFirstSeenAt = Date.now()
        console.log('[NoteAI] candidate Teams audio track via ' + sourceLabel + ':', track.id.slice(0, 8))
      }
    } catch (err) {
      console.log('[NoteAI] captureTrack error:', err && err.message)
    }
  }

  // Energy-pick one mixed candidate (only when there are NO RTC tracks).
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
      console.log('[NoteAI] forwarding Teams audio (mixed) from', bestId.slice(0, 8), '(level', bestLevel.toFixed(1) + ')')
      startForwarding(c.source, MIX_TRACK_ID)
    }
  }

  // Per-RTC-track co-occurrence: bind track → speaker via DOM active-speaker.
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
    const name = getTeamsActiveSpeaker()
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

  // ── Path 1: Web Audio output tap (mixed remote stream) ────────────────────
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

  // ── Path 3: per-participant RTCPeerConnection tracks ──────────────────────
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
  // Screen-share pseudo-tiles ("X's screen", "Content") must never be treated as
  // a speaking participant — otherwise starting a share swaps the active speaker
  // (and every transcript segment) to a non-person.
  const PSEUDO_NAME_RE = /(presentation|is presenting|is sharing|screen ?share|screenshar|shared screen|'s screen|\bscreen\b\s*$|^content$)/i
  function cleanName (raw) {
    let name = (raw || '').trim()
    name = name.replace(/,\s*(unmuted|muted|speaking|host|co-host|organizer|presenter|guest).*$/i, '').trim()
    name = name.replace(/\s*\((guest|host|co-host|organizer|presenter|external)\)\s*$/i, '').trim()
    if (name.length >= 4 && name.length % 2 === 0) {
      const half = name.length / 2
      if (name.slice(0, half) === name.slice(half)) name = name.slice(0, half)
    }
    if (!name || name.length < 2 || /^note|recorder/i.test(name)) return null
    if (PSEUDO_NAME_RE.test(name)) return null
    return name
  }

  function extractNameFrom (el) {
    let node = el
    for (let depth = 0; node && depth < 10; depth++, node = node.parentElement) {
      const aria = node.getAttribute && node.getAttribute('aria-label')
      if (aria) {
        const m = aria.match(/(.+?)\s+is speaking/i)
        const name = cleanName(m ? m[1] : aria)
        if (name) return name
      }
      if (!node.querySelector) continue
      const nameEl = node.querySelector(
        '[data-tid="roster-cell-displayname"], [data-tid*="display-name" i], ' +
        '[data-tid="calling-participant-name"], [data-tid*="participant-name" i], ' +
        '[class*="displayName" i], [title], [aria-label]'
      )
      if (nameEl) {
        const raw = nameEl.getAttribute('aria-label') || nameEl.getAttribute('title') || nameEl.textContent
        const m = (raw || '').match(/(.+?)\s+is speaking/i)
        const name = cleanName(m ? m[1] : raw)
        if (name) return name
      }
    }
    return null
  }

  function isVisible (el) {
    if (!el || !el.offsetParent) return false
    try {
      const s = getComputedStyle(el)
      return s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity || '1') > 0.05
    } catch { return true }
  }

  // Strategy 0 — roster speaking indicator (most stable signal).
  function getActiveSpeakerFromRoster () {
    const cells = Array.from(document.querySelectorAll(
      '[data-tid="roster-cell-name"], [data-tid="roster-participant"], [role="treeitem"]'
    ))
    const speaking = []
    for (const cell of cells) {
      let container = cell
      for (let d = 0; d < 4 && container.parentElement; d++) {
        if (container.querySelector && container.querySelector('[data-tid="roster-cell-name"]')) break
        container = container.parentElement
      }
      const speaks = !!container.querySelector && (
        container.querySelector('[class*="speaking" i]') ||
        container.querySelector('[class*="voiceLevel" i], [class*="voice-level" i]') ||
        container.querySelector('[data-tid*="voice-level" i]:not(.vdi-frame-occlusion)') ||
        container.querySelector('[aria-label*="speaking" i]')
      )
      if (!speaks) continue
      const nameEl = container.querySelector('[data-tid="roster-cell-name"]') || container
      const raw = nameEl.getAttribute('title') || nameEl.textContent
      const name = cleanName((raw || '').replace(/\s+is speaking.*$/i, ''))
      if (name) speaking.push(name)
    }
    const unique = [...new Set(speaking)]
    return unique.length === 1 ? unique[0] : null
  }

  function getTeamsActiveSpeaker () {
    try {
      const rosterName = getActiveSpeakerFromRoster()
      if (rosterName) return rosterName
    } catch {}

    const selectors = [
      '[data-tid="participant-speaking-indicator"][aria-label]',
      '[class*="speaking"][aria-label]',
      '[class*="vdi-frame"][class*="speaking"] [class*="name"]',
      '[data-tid="video-tile"][class*="speaking"] span[title]',
      '[class*="active-speaker"] span[title]',
    ]
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel)
        if (el) {
          const raw = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent
          const m = (raw || '').match(/(.+?)\s+is speaking/i)
          const name = cleanName(m ? m[1] : raw)
          if (name) return name
        }
      } catch {}
    }

    // voice-level-stream-outline: active speaker's outline does NOT have vdi-frame-occlusion.
    try {
      const outlines = Array.from(document.querySelectorAll('[data-tid="voice-level-stream-outline"]'))
      const active = outlines.filter(el => !(el.getAttribute('class') || '').includes('vdi-frame-occlusion'))
      if (active.length === 1) {
        const name = extractNameFrom(active[0])
        if (name) return name
      }
    } catch {}

    try {
      const flagged = Array.from(document.querySelectorAll(
        '[class*="speaking" i], [class*="active-speaker" i]'
      )).filter(isVisible)
      if (flagged.length === 1) {
        const name = extractNameFrom(flagged[0])
        if (name) return name
      }
    } catch {}

    return null
  }

  // Diagnostic dump — fires early in the session to help pin live selectors.
  const DIAG_MAX = 10
  const DIAG_EVERY_POLLS = 10
  let diagDumps = 0
  let diagPollCount = 0
  let detectedOnce = false
  function dumpSpeakingCandidates () {
    if (detectedOnce || diagDumps >= DIAG_MAX) return
    if (diagPollCount++ % DIAG_EVERY_POLLS !== 0) return
    diagDumps++
    let outlines = []
    try {
      outlines = Array.from(document.querySelectorAll('[data-tid="voice-level-stream-outline"]'))
    } catch {}
    if (outlines.length === 0) {
      console.log('[NoteAI][diag] no voice-level-stream-outline elements (dump ' + diagDumps + '/' + DIAG_MAX + ')')
      return
    }
    const active = outlines.filter(el => !(el.getAttribute('class') || '').includes('vdi-frame-occlusion'))
    const target = active.length === 1 ? active[0] : outlines[0]
    console.log('[NoteAI][diag] outlines=' + outlines.length + ' active=' + active.length +
      ' extractName="' + (extractNameFrom(target) || '?') + '"')
    let node = target
    for (let d = 0; node && d < 10; d++, node = node.parentElement) {
      const tag = node.tagName ? node.tagName.toLowerCase() : '?'
      const tid = (node.getAttribute && node.getAttribute('data-tid')) || ''
      const aria = ((node.getAttribute && node.getAttribute('aria-label')) || '').slice(0, 50)
      const title = (node.getAttribute && node.getAttribute('title')) || ''
      const role = (node.getAttribute && node.getAttribute('role')) || ''
      const txt = (node.textContent || '').trim().slice(0, 40)
      console.log('[NoteAI][diag]  ^' + d + ' <' + tag + '> tid="' + tid + '" role="' + role +
        '" aria="' + aria + '" title="' + title + '" text="' + txt + '"')
    }
  }

  function sendEvent (payload) {
    if (window.noteAISendEvent) window.noteAISendEvent(JSON.stringify(payload))
  }

  let lastSpeaker = null
  function pollActiveSpeaker () {
    let name = null
    try { name = getTeamsActiveSpeaker() } catch {}
    if (!name) { dumpSpeakingCandidates(); }
    if (name === lastSpeaker) return
    if (lastSpeaker) sendEvent({ type: 'speaker_end', name: lastSpeaker, endMs: Date.now() })
    if (name) {
      detectedOnce = true
      sendEvent({ type: 'speaker_start', name, startMs: Date.now() })
      console.log('[NoteAI] active speaker:', name)
    }
    lastSpeaker = name
  }

  // ── Screen-share detection ────────────────────────────────────────────────
  // Teams renders a share stage plus "<name> is presenting" / "is sharing"
  // status text. Emit the same screenshare_start/update/end events the Meet and
  // Zoom injectors produce so the backend persists them and speaker attribution
  // stays presentation-aware.
  let shareState = 'inactive'
  let sharePresenter = null

  function detectTeamsShare () {
    try {
      const container = document.querySelector(
        '[data-tid="sharing-stage"], [data-tid*="screenshare" i], [data-tid*="share-stage" i], [class*="screenShare" i]'
      )
      const txt = (document.body.innerText || '').slice(0, 5000)
      const m = txt.match(/(.{2,60}?)\s+is (?:presenting|sharing)/i)
      const presenter = m ? cleanName(m[1]) : null
      return { active: Boolean(container) || /is presenting|is sharing/i.test(txt), presenter }
    } catch { return { active: false, presenter: null } }
  }

  function pollScreenShare () {
    const { active, presenter } = detectTeamsShare()
    const state = active ? 'active' : 'inactive'
    if (state !== shareState) {
      shareState = state
      sharePresenter = presenter
      if (state === 'active') {
        sendEvent({ type: 'screenshare_start', presenter, startMs: Date.now() })
        console.log('[NoteAI] screen-share STARTED', presenter ? 'by ' + presenter : '')
      } else {
        sendEvent({ type: 'screenshare_end', presenter: sharePresenter, endMs: Date.now() })
        sharePresenter = null
        console.log('[NoteAI] screen-share ENDED')
      }
    } else if (state === 'active' && presenter && presenter !== sharePresenter) {
      sharePresenter = presenter
      sendEvent({ type: 'screenshare_update', presenter, ms: Date.now() })
    }
  }

  setTimeout(function () {
    console.log('[NoteAI] Teams speaker polling started')
    setInterval(pollActiveSpeaker, 300)
    setInterval(pollScreenShare, 1000)
  }, 5000)
})()
