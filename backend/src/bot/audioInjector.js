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
  let workletReady = false      // true once the AudioWorklet module loads (may be CSP-blocked)
  const connectedTracks = new Set()
  const trackMeta = new Map()  // trackId → { analyser, dataArray, index }
  let trackIndex = 0
  const speakingNow = new Map()
  const SPEAK_THRESHOLD = 8   // 0-255 average frequency energy
  let _internalCMSS = false   // true while WE call createMediaStreamSource (skip self-hook)

  // Exposed to page.evaluate so pollParticipantNames can resolve track→name
  window.__noteAITrackList = []   // [{trackId, index}]

  // ── Capture path C: hook Meet's Web Audio rendering ───────────────────────
  // On real Google Meet the raw remote track reads silent (see addAudioTrack /
  // captureViaTrackProcessor notes), and if Meet renders audio through its OWN
  // AudioContext (createMediaStreamSource → destination) rather than <audio>
  // elements, the element tap finds nothing either. So we intercept every
  // MediaStreamSource Meet builds and tee it through a ScriptProcessor on Meet's
  // OWN context — reading the exact post-render samples Meet is about to play.
  // ScriptProcessor needs no module fetch, so Meet's CSP can't block it. Each
  // intercepted source gets its own trackId ('wasrc-N') → its own Deepgram stream
  // (no chunk interleaving). Silent sources simply produce no transcripts.
  let waSrcCount = 0

  // Every AudioContext our capture depends on (our own + each of Meet's that we
  // tee through). Chrome can flip a context to 'suspended' mid-meeting (e.g.
  // after long inactivity in an automated tab), which silently freezes every
  // worklet/ScriptProcessor on it — capture stops and never comes back. A
  // periodic resume makes the pipeline self-heal so transcription resumes as
  // soon as speech does.
  const watchedCtxs = new Set()
  setInterval(() => {
    for (const c of watchedCtxs) {
      try {
        if (c.state === 'suspended') {
          c.resume().catch(() => {})
          console.log('[NoteAI] resumed suspended AudioContext')
        }
      } catch {}
    }
  }, 5000)

  function tapWebAudioSource (ctx, node) {
    try {
      watchedCtxs.add(ctx)
      const id = 'wasrc-' + (waSrcCount++)
      const sp = ctx.createScriptProcessor(4096, 1, 1)
      const step = ctx.sampleRate / SAMPLE_RATE
      let native = [], readPos = 0, out = []
      let firstChunk = false, dbgSum = 0, dbgN = 0, dbgLast = Date.now()
      sp.onaudioprocess = (e) => {
        const ch = e.inputBuffer.getChannelData(0)
        for (let i = 0; i < ch.length; i++) { native.push(ch[i]); dbgSum += ch[i] * ch[i]; dbgN++ }
        while (readPos + 1 < native.length) {
          const idx = readPos | 0, frac = readPos - idx
          const s = native[idx] * (1 - frac) + native[idx + 1] * frac
          const v = s < -1 ? -1 : s > 1 ? 1 : s
          out.push(v < 0 ? v * 32768 : v * 32767)
          readPos += step
          if (out.length >= CHUNK_SAMPLES) {
            if (!firstChunk) { firstChunk = true; console.log('[NoteAI] audio flowing for ' + id + ' (web-audio tap)') }
            if (window.noteAISendTrackAudio) window.noteAISendTrackAudio(out, id)
            out = []
          }
        }
        const consumed = readPos | 0
        if (consumed > 0) { native.splice(0, consumed); readPos -= consumed }
        const now = Date.now()
        if (now - dbgLast > 3000) {
          console.log('[NoteAI] DIAG ' + id + ' webAudioRMS=' + Math.sqrt(dbgSum / Math.max(dbgN, 1)).toFixed(4))
          dbgSum = 0; dbgN = 0; dbgLast = now
        }
      }
      // ScriptProcessor only fires while connected to a destination; route through
      // zero gain so it runs without echoing Meet's audio back out.
      const zero = ctx.createGain(); zero.gain.value = 0
      node.connect(sp); sp.connect(zero); zero.connect(ctx.destination)
      console.log('[NoteAI] hooked Web Audio MediaStreamSource → ' + id)
    } catch (e) { console.log('[NoteAI] web-audio tap failed -', (e && e.message)) }
  }

  ;(function patchWebAudio () {
    for (const C of [window.AudioContext, window.webkitAudioContext]) {
      if (!C || !C.prototype) continue
      const orig = C.prototype.createMediaStreamSource
      if (!orig || orig.__noteAIWrapped) continue
      const wrapped = function (stream) {
        const node = orig.call(this, stream)
        try {
          if (!_internalCMSS && stream && stream.getAudioTracks && stream.getAudioTracks().length > 0) {
            tapWebAudioSource(this, node)
          }
        } catch {}
        return node
      }
      wrapped.__noteAIWrapped = true
      C.prototype.createMediaStreamSource = wrapped
    }
  })()

  const meetingId = (function () {
    const m = location.pathname.match(/\/([a-z]{3}-[a-z]{4}-[a-z]{3})/)
    return m ? m[1] : `bot-${Date.now()}`
  })()

  // ── Audio pipeline init ───────────────────────────────────────

  async function initAudio () {
    // IMPORTANT: do NOT force `sampleRate` here. A non-default AudioContext rate
    // makes a MediaStreamAudioSourceNode built from a *remote* WebRTC track emit
    // pure silence in Chrome (confirmed: track live+unmuted, sink decoding with
    // readyState 4, yet analyserRMS=0). We run the context at its native rate
    // (usually 48k) and downsample to 16k inside the worklet instead.
    audioCtx = new AudioContext()
    watchedCtxs.add(audioCtx)   // keep it running for the life of the meeting
    // A fresh AudioContext can start 'suspended' in an automated tab with no user
    // gesture, which silently stalls the analyser/worklet. Resume it (and again on
    // the first track) so remote audio actually flows.
    try { if (audioCtx.state === 'suspended') await audioCtx.resume() } catch {}

    // Worklet downsamples from the context's native `sampleRate` to TARGET_RATE
    // (16k) via linear interpolation, then emits ${CHUNK_SAMPLES}-sample (200ms)
    // Int16 chunks — the rate the STT sidecars/Deepgram expect.
    const workletCode = `
      const TARGET_RATE = ${SAMPLE_RATE}
      const CHUNK = ${CHUNK_SAMPLES}
      class PCMSender extends AudioWorkletProcessor {
        constructor () {
          super()
          this._native = []          // queued native-rate float samples
          this._readPos = 0          // fractional read cursor into _native
          this._out = []             // resampled int16 @ TARGET_RATE
          this._step = sampleRate / TARGET_RATE  // native samples per output sample
        }
        process (inputs) {
          const ch = inputs[0] && inputs[0][0]
          if (!ch) return true
          for (let i = 0; i < ch.length; i++) this._native.push(ch[i])
          while (this._readPos + 1 < this._native.length) {
            const idx = this._readPos | 0
            const frac = this._readPos - idx
            const s = this._native[idx] * (1 - frac) + this._native[idx + 1] * frac
            const v = s < -1 ? -1 : s > 1 ? 1 : s
            this._out.push(v < 0 ? v * 32768 : v * 32767)
            this._readPos += this._step
            if (this._out.length >= CHUNK) {
              this.port.postMessage({ samples: this._out, trackId: this._trackId })
              this._out = []
            }
          }
          const consumed = this._readPos | 0
          if (consumed > 0) { this._native.splice(0, consumed); this._readPos -= consumed }
          return true
        }
      }
      registerProcessor('pcm-sender', PCMSender)
    `
    // AudioWorklet needs to fetch a module URL. Google Meet's Content-Security-Policy
    // can block a blob: URL, which would throw here and silently kill audio capture
    // (the track still gets named via the index fallback). Catch it and fall back
    // to a ScriptProcessorNode, which needs no module fetch.
    try {
      const blob = new Blob([workletCode], { type: 'application/javascript' })
      const url  = URL.createObjectURL(blob)
      await audioCtx.audioWorklet.addModule(url)
      URL.revokeObjectURL(url)
      workletReady = true
      console.log('[NoteAI] audio context ready (AudioWorklet)')
    } catch (e) {
      workletReady = false
      console.log('[NoteAI] AudioWorklet unavailable (' + (e && e.message) + ') — using ScriptProcessor fallback')
    }
  }

  // Read decoded audio frames directly off a MediaStreamTrack via WebCodecs,
  // downsample to 16k, and emit 200ms Int16 chunks. Bypasses the WebAudio graph,
  // which delivers silence for Meet's remote tracks in this Chrome build.
  function captureViaTrackProcessor (track, trackId, emit) {
    // A single reader.read() failure must NOT permanently kill this track's
    // capture — that turns a transient glitch (long silence, renderer hiccup)
    // into "transcription never resumes for this participant". While the track
    // is still live we re-attach a fresh processor and keep going.
    let retries = 0
    const MAX_RETRIES = 30
    const startReader = () => {
    let proc
    try { proc = new MediaStreamTrackProcessor({ track }) }
    catch (e) { console.log('[NoteAI] TrackProcessor init failed for', trackId.slice(0, 8), '-', (e && e.message)); return }
    const reader = proc.readable.getReader()
    const TARGET = SAMPLE_RATE
    let native = [], readPos = 0, out = []
    let frames = 0, dbgSum = 0, dbgN = 0, dbgLast = Date.now()

    ;(async () => {
      while (true) {
        let r
        try { r = await reader.read() } catch (e) {
          if (track.readyState === 'live' && retries++ < MAX_RETRIES) {
            console.log('[NoteAI] TrackProcessor read error for ' + trackId.slice(0, 8) +
              ' (' + (e && e.message) + ') — re-attaching, attempt ' + retries)
            setTimeout(startReader, 2000)
          } else {
            console.log('[NoteAI] TrackProcessor stopped for ' + trackId.slice(0, 8) +
              ' (track ' + track.readyState + ', retries ' + retries + ')')
          }
          return
        }
        if (r.done) break
        const frame = r.value
        try {
          const n = frame.numberOfFrames
          const rate = frame.sampleRate || 48000
          const fmt = frame.format || 'f32-planar'
          let floats
          if (fmt.indexOf('f32') === 0) {
            floats = new Float32Array(n)
            frame.copyTo(floats, { planeIndex: 0 })
          } else if (fmt.indexOf('s16') === 0) {
            const i16 = new Int16Array(n)
            frame.copyTo(i16, { planeIndex: 0 })
            floats = new Float32Array(n)
            for (let i = 0; i < n; i++) floats[i] = i16[i] / 32768
          } else {
            floats = new Float32Array(n)
            frame.copyTo(floats, { planeIndex: 0 })
          }
          frame.close()

          const step = rate / TARGET
          for (let i = 0; i < n; i++) { native.push(floats[i]); dbgSum += floats[i] * floats[i]; dbgN++ }
          while (readPos + 1 < native.length) {
            const idx = readPos | 0, frac = readPos - idx
            const s = native[idx] * (1 - frac) + native[idx + 1] * frac
            const v = s < -1 ? -1 : s > 1 ? 1 : s
            out.push(v < 0 ? v * 32768 : v * 32767)
            readPos += step
            if (out.length >= CHUNK_SAMPLES) { emit(out); out = [] }
          }
          const consumed = readPos | 0
          if (consumed > 0) { native.splice(0, consumed); readPos -= consumed }

          if (++frames === 1) {
            retries = 0   // healthy again — a later glitch gets a fresh retry budget
            console.log('[NoteAI] TrackProcessor first frame', trackId.slice(0, 8), 'rate=' + rate, 'fmt=' + fmt, 'ch=' + (frame.numberOfChannels || 1))
          }
          const now = Date.now()
          if (now - dbgLast > 3000) {
            const rms = Math.sqrt(dbgSum / Math.max(dbgN, 1))
            console.log('[NoteAI] TrackProcessor ' + trackId.slice(0, 8) + ' rms=' + rms.toFixed(4) + ' (' + frames + ' frames)')
            dbgSum = 0; dbgN = 0; dbgLast = now
          }
        } catch (e) { try { frame.close() } catch (e2) {} }
      }
    })()
    }
    startReader()
  }

  async function addAudioTrack (track, pc) {
    if (connectedTracks.has(track.id)) return
    connectedTracks.add(track.id)
    const trackId  = track.id
    const myIndex  = trackIndex++
    console.log('[NoteAI] new audio track:', trackId.slice(0, 8), 'index:', myIndex)
    window.__noteAITrackList.push({ trackId, index: myIndex })

    try {
      // Singleton init — all concurrent calls share the same promise
      if (!audioInitPromise) audioInitPromise = initAudio()
      await audioInitPromise

      const stream   = new MediaStream([track])

      // CRITICAL: a MediaStreamAudioSourceNode built from a *remote* WebRTC track
      // emits SILENCE in Chrome unless the track is also consumed by a media
      // element. Without this the worklet/analyser receive all-zero samples —
      // audio "flows" to the backend but transcribes to nothing (the exact
      // "track named, no transcription" symptom). A muted, autoplaying <audio>
      // sink forces Chrome to decode the track so real samples reach WebAudio.
      // Muted keeps it from echoing into the bot's own mic / playing aloud.
      try {
        // The context may still be suspended when the first track arrives.
        if (audioCtx.state === 'suspended') { try { await audioCtx.resume() } catch {} }
        const sink = document.createElement('audio')
        sink.muted = true
        sink.autoplay = true
        sink.setAttribute('playsinline', '')
        sink.volume = 0
        sink.srcObject = stream
        // CRITICAL: the sink element must be IN THE DOM for Chrome to actually
        // decode a *remote* WebRTC track. A detached `new Audio()` does not
        // reliably pump samples in a headless/automated tab, so the analyser and
        // worklet receive all-zero frames → audio "flows" but transcribes to
        // nothing. Append it hidden and keep a reference so it isn't GC'd.
        sink.style.display = 'none'
        document.body.appendChild(sink)
        const pl = sink.play()
        if (pl && pl.catch) pl.catch(() => {})
        ;(window.__noteAISinks = window.__noteAISinks || []).push(sink)  // retain ref so it isn't GC'd
      } catch (e) {
        console.log('[NoteAI] audio sink failed for', trackId.slice(0, 8), '-', (e && e.message))
      }

      _internalCMSS = true
      const source   = audioCtx.createMediaStreamSource(stream)
      _internalCMSS = false

      // Per-track analyser — measures audio level for speaking detection
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.4
      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      source.connect(analyser)
      trackMeta.set(trackId, { analyser, dataArray, index: myIndex, pc })

      // DIAGNOSTIC: report where the signal dies — is the remote track itself
      // muted/not delivering, or does WebAudio receive zeros despite a live track?
      // Runs for the LIFE of the track (not just the first 20s): a meeting that
      // produces no transcripts because the bot is fed silence is exactly the case
      // we need to keep observing — when transcripts are missing, these lines tell
      // us whether the remote track is muted at source (trk.muted=true / silence
      // from the SFU) or the sink stopped decoding. Verbose for the first ~20s,
      // then throttled to once every ~15s so long sessions stay diagnosable
      // without flooding the bot log.
      {
        let dn = 0
        const td = new Uint8Array(analyser.fftSize)
        const iv = setInterval(() => {
          try {
            analyser.getByteTimeDomainData(td)
            let s = 0
            for (let i = 0; i < td.length; i++) { const v = (td[i] - 128) / 128; s += v * v }
            const rms = Math.sqrt(s / td.length)
            // After the initial burst, only emit every ~15s (every 8th 2s tick).
            dn++
            if (dn > 10 && dn % 8 !== 0) return
            const sink = (window.__noteAISinks || []).slice(-1)[0]
            console.log('[NoteAI] DIAG ' + trackId.slice(0, 8) +
              ' analyserRMS=' + rms.toFixed(4) +
              ' ctx=' + audioCtx.state +
              ' trk.enabled=' + track.enabled +
              ' trk.muted=' + track.muted +
              ' trk.state=' + track.readyState +
              ' sink.paused=' + (sink ? sink.paused : 'n/a') +
              ' sink.ready=' + (sink ? sink.readyState : 'n/a'))
            // Stop only once the track is truly gone — nothing more to report.
            if (track.readyState === 'ended') clearInterval(iv)
          } catch (e) { clearInterval(iv) }
        }, 2000)
      }

      // Confirm-once that audio actually reaches Node for this track — turns a
      // silent "no transcription" into an observable signal in the bot logs.
      let firstChunkLogged = false
      const emit = (samples) => {
        if (!firstChunkLogged) { firstChunkLogged = true; console.log('[NoteAI] audio flowing for', trackId.slice(0, 8)) }
        if (window.noteAISendTrackAudio) window.noteAISendTrackAudio(samples, trackId)
      }

      if (window.MediaStreamTrackProcessor) {
        // PRIMARY: read decoded audio frames straight off the track via WebCodecs.
        // This bypasses createMediaStreamSource, which yields pure silence for
        // Meet's remote tracks in this Chrome (confirmed: track live+unmuted, sink
        // decoding, yet analyserRMS=0). Reliable for remote SFU audio.
        console.log('[NoteAI] capturing via MediaStreamTrackProcessor for', trackId.slice(0, 8))
        captureViaTrackProcessor(track, trackId, emit)
      } else if (workletReady) {
        // Per-track worklet — sends audio for this one participant
        const worklet = new AudioWorkletNode(audioCtx, 'pcm-sender')
        worklet.port.onmessage = (e) => emit(e.data.samples)
        source.connect(worklet)
      } else {
        // ScriptProcessor fallback — used when the AudioWorklet module was blocked.
        // Downsamples native rate → 16k (linear interp) and emits 200ms chunks.
        const sp = audioCtx.createScriptProcessor(4096, 1, 1)
        const step = audioCtx.sampleRate / SAMPLE_RATE
        let native = [], readPos = 0, out = []
        sp.onaudioprocess = (e) => {
          const ch = e.inputBuffer.getChannelData(0)
          for (let i = 0; i < ch.length; i++) native.push(ch[i])
          while (readPos + 1 < native.length) {
            const idx = readPos | 0, frac = readPos - idx
            const s = native[idx] * (1 - frac) + native[idx + 1] * frac
            const v = s < -1 ? -1 : s > 1 ? 1 : s
            out.push(v < 0 ? v * 32768 : v * 32767)
            readPos += step
            if (out.length >= CHUNK_SAMPLES) { emit(out); out = [] }
          }
          const consumed = readPos | 0
          if (consumed > 0) { native.splice(0, consumed); readPos -= consumed }
        }
        // A ScriptProcessor only fires while connected to a destination. Route it
        // through a zero-gain node so it runs but stays silent.
        const zero = audioCtx.createGain(); zero.gain.value = 0
        source.connect(sp); sp.connect(zero); zero.connect(audioCtx.destination)
      }
    } catch (e) {
      console.log('[NoteAI] addAudioTrack FAILED for', trackId.slice(0, 8), '-', (e && e.message))
    }

    // SSRC fast-path runs every tick of checkSpeakers() until name is locked.
    // No index-based fallback — that was the source of swapped names.
  }

  // ── Fallback capture: tap Meet's OWN playback audio ───────────────────────
  // On real Google Meet, reading the raw remote WebRTC track (via
  // MediaStreamTrackProcessor OR createMediaStreamSource) can yield pure silence
  // even while Meet is decoding and PLAYING that audio — confirmed in production:
  // three remote tracks at RMS=0 for an entire meeting while a participant was
  // clearly speaking, yet the identical capture path reads real audio on a
  // synthetic WebRTC loopback. The raw-track read is the unreliable link.
  //
  // Meet renders remote audio through <audio>/<video> elements. A
  // MediaElementAudioSourceNode taps the element's POST-DECODE output — literally
  // the samples a human would hear — so it carries real audio whenever Meet is
  // playing sound, regardless of how the SFU multiplexes the underlying track.
  // We mix every tapped element into one stream emitted as 'meet-mixed'; speaker
  // attribution then rides on the DOM active-speaker events the backend already
  // correlates (currentSpeaker / co-occurrence voting in ingestHandler).
  const tappedEls = new WeakSet()
  let mixSink = null            // shared gain node every element tap feeds into
  let mixCapturing = false
  let tapCount = 0

  async function ensureMixTap () {
    if (mixCapturing || !audioInitPromise) return
    mixCapturing = true
    try { await audioInitPromise } catch {}
    if (!audioCtx) { mixCapturing = false; return }
    const MIX_ID = 'meet-mixed'
    let firstChunkLogged = false
    const emit = (samples) => {
      if (!firstChunkLogged) { firstChunkLogged = true; console.log('[NoteAI] audio flowing for meet-mixed (element tap)') }
      if (window.noteAISendTrackAudio) window.noteAISendTrackAudio(samples, MIX_ID)
    }

    mixSink = audioCtx.createGain(); mixSink.gain.value = 1
    // Keep the graph pulling even if nothing else consumes it (muted output).
    const zero = audioCtx.createGain(); zero.gain.value = 0
    mixSink.connect(zero); zero.connect(audioCtx.destination)

    if (workletReady) {
      const worklet = new AudioWorkletNode(audioCtx, 'pcm-sender')
      worklet.port.onmessage = (e) => emit(e.data.samples)
      mixSink.connect(worklet)
    } else {
      const sp = audioCtx.createScriptProcessor(4096, 1, 1)
      const step = audioCtx.sampleRate / SAMPLE_RATE
      let native = [], readPos = 0, out = []
      sp.onaudioprocess = (e) => {
        const ch = e.inputBuffer.getChannelData(0)
        for (let i = 0; i < ch.length; i++) native.push(ch[i])
        while (readPos + 1 < native.length) {
          const idx = readPos | 0, frac = readPos - idx
          const s = native[idx] * (1 - frac) + native[idx + 1] * frac
          const v = s < -1 ? -1 : s > 1 ? 1 : s
          out.push(v < 0 ? v * 32768 : v * 32767)
          readPos += step
          if (out.length >= CHUNK_SAMPLES) { emit(out); out = [] }
        }
        const consumed = readPos | 0
        if (consumed > 0) { native.splice(0, consumed); readPos -= consumed }
      }
      mixSink.connect(sp); sp.connect(zero)
    }

    // Diagnostic: report the mixed element-tap level so a silent vs audible
    // session is visible in bot-diag.log (throttled like the per-track DIAG).
    const an = audioCtx.createAnalyser(); an.fftSize = 512
    mixSink.connect(an)
    const td = new Uint8Array(an.fftSize)
    let dn = 0
    setInterval(() => {
      try {
        an.getByteTimeDomainData(td)
        let s = 0; for (let i = 0; i < td.length; i++) { const v = (td[i] - 128) / 128; s += v * v }
        const rms = Math.sqrt(s / td.length)
        dn++
        if (dn <= 10 || dn % 8 === 0) console.log('[NoteAI] DIAG meet-mixed elementRMS=' + rms.toFixed(4) + ' taps=' + tapCount)
      } catch {}
    }, 2000)
  }

  function scanPlaybackElements () {
    if (!audioInitPromise) return   // no track yet → no AudioContext yet
    if (!mixSink) { ensureMixTap(); return }
    const ownSinks = window.__noteAISinks || []
    for (const el of document.querySelectorAll('audio, video')) {
      if (tappedEls.has(el)) continue
      // Skip our OWN per-track decode sinks — they're muted (volume 0), so a
      // MediaElementSource taps post-mute silence. Only Meet's real, audible
      // playback elements carry usable samples.
      if (ownSinks.indexOf(el) !== -1 || el.muted || el.volume === 0) continue
      const so = el.srcObject
      const hasAudio = so && typeof so.getAudioTracks === 'function' && so.getAudioTracks().length > 0
      if (!hasAudio) continue
      tappedEls.add(el)   // mark before tapping so a throw doesn't retry forever
      let src
      try { src = audioCtx.createMediaElementSource(el) }
      catch (e) { console.log('[NoteAI] element tap skipped -', (e && e.message)); continue }
      src.connect(mixSink)
      tapCount++
      console.log('[NoteAI] tapped Meet playback element #' + tapCount + ' (audioTracks=' + so.getAudioTracks().length + ')')
    }
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

  // Screen-share pseudo-tiles ("X (Presentation)", "X's screen", generic
  // "Presentation") are not people. If one is ever treated as a participant,
  // starting a screen share silently renames speakers mid-meeting.
  const PSEUDO_NAME_RE = /(presentation|is presenting|presenting now|'s screen|screen share|screenshar|shared screen|\bscreen\b\s*$)/i
  function isPseudoName (name) {
    return !name || PSEUDO_NAME_RE.test(String(name).trim())
  }

  function getName (tile) {
    const n = getNameRaw(tile)
    return isPseudoName(n) ? null : n
  }

  function getNameRaw (tile) {
    // Primary (Vexa-derived): span.notranslate — Meet's canonical name element,
    // survives UI redesigns better than hover-button patterns.
    const notranslate = tile.querySelector('span.notranslate')
    if (notranslate) {
      const t = (notranslate.textContent || '').trim()
      if (t.length > 1 && t.length < 50 && !/^note|recorder/i.test(t)) return t
    }

    // "More options for <name>" button (visible on hover)
    for (const btn of tile.querySelectorAll('button[aria-label]')) {
      const m = (btn.getAttribute('aria-label') || '').match(/^More options for (.+)$/i)
      if (m) return m[1].trim()
    }
    // Data attributes
    const d = tile.getAttribute('data-self-name') || tile.getAttribute('data-participant-name')
    if (d) return d.trim()
    // Known obfuscated name class names (may rotate with Meet releases)
    for (const cls of ['.zWGUib', '.cS7aqe', '.XWGOtd']) {
      const el = tile.querySelector(cls)
      if (el) {
        const t = (el.textContent || '').trim()
        if (t.length > 1 && t.length < 50) return t
      }
    }
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
          // The big tile is usually the presentation itself, named like
          // "Prince S (Presentation)" — strip the suffix to get the human.
          const raw = getNameRaw(sized[0].t)
          if (raw) {
            const human = String(raw).replace(/\s*\((?:presentation|screen ?share)\)\s*$/i, '').replace(/'s (?:presentation|screen)\s*$/i, '').trim()
            if (human && !isPseudoName(human)) return human
          }
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
      // Signal 0 (Vexa primary): data-audio-level attribute — semantic and stable
      // across Meet UI redesigns; set to a nonzero value while the participant speaks.
      if (tile.querySelector('[data-audio-level]:not([data-audio-level="0"])')) return true

      // Signal 1 (Vexa obfuscated classes — may rotate with Meet releases):
      for (const cls of ['Oaajhc', 'HX2H7', 'wEsLMd', 'OgVli']) {
        if (tile.querySelector('.' + cls)) return true
      }

      // Signal 2: any class on tile or descendant containing "speak"
      if (tile.matches('[class*="speak" i]')) return true
      if (tile.querySelector('[class*="speak" i]:not([class*="speaker-name" i])')) return true

      // Signal 3: aria-label hints
      const ariaSpeaking = tile.querySelector('[aria-label*="speaking" i],[aria-label*="talking" i]')
      if (ariaSpeaking) return true

      // Signal 4: animated audio meter — Meet renders a small SVG/canvas visible
      // only while talking.
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

    // Fallback: on real Meet the per-track analysers read silent (audio is captured
    // via the element / Web-Audio taps instead), so `loudTracks` is empty and no
    // speaker_start is emitted above — leaving the backend with no active speaker,
    // so mixed-stream transcripts show "Speaker N" instead of a real name. Drive
    // the active speaker from the DOM "currently speaking" tiles alone in that case.
    if (!loudTracks.length && domNames.length) {
      for (const name of domNames) {
        now.add(name)
        if (!speakingNow.has(name)) {
          speakingNow.set(name, Date.now())
          sendEvent({ type: 'speaker_start', name, startMs: Date.now(), meetingId })
        }
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
      // Tap Meet's playback elements as a robust audio source (the raw remote
      // track can read silent on real Meet). New participant elements appear over
      // time, so keep scanning.
      scanPlaybackElements()
      setInterval(scanPlaybackElements, 2000)
    }
  }, 1500)

})()
