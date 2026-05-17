;(function () {
  'use strict'

  window.__noteAITabCaptureLoaded = true

  async function startTabAudioCapture () {
    if (window.__noteAITabCaptureActive) return
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        systemAudio: 'include',
      })

      stream.getVideoTracks().forEach(t => t.stop())
      const audioTrack = stream.getAudioTracks()[0]
      if (!audioTrack) throw new Error('No audio track in display capture stream')

      // AudioContext at 16kHz — no downsampling needed; Chromium resamples for us.
      const audioCtx = new AudioContext({ sampleRate: 16000 })

      const workletCode = `
        class PCMSender extends AudioWorkletProcessor {
          constructor () {
            super()
            this._buf = []
            this._n = 0
            this._chunkSize = 3200   // 200ms @ 16kHz
          }
          process (inputs) {
            const ch = inputs[0]?.[0]
            if (!ch) return true
            const i16 = new Int16Array(ch.length)
            for (let i = 0; i < ch.length; i++) {
              const v = Math.max(-1, Math.min(1, ch[i]))
              i16[i] = v < 0 ? v * 32768 : v * 32767
            }
            this._buf.push(i16)
            this._n += i16.length
            if (this._n >= this._chunkSize) {
              const out = new Int16Array(this._n)
              let off = 0
              for (const b of this._buf) { out.set(b, off); off += b.length }
              this.port.postMessage({ samples: Array.from(out) })
              this._buf = []
              this._n = 0
            }
            return true
          }
        }
        registerProcessor('tab-pcm-sender', PCMSender)
      `
      const blob = new Blob([workletCode], { type: 'application/javascript' })
      const url = URL.createObjectURL(blob)
      await audioCtx.audioWorklet.addModule(url)
      URL.revokeObjectURL(url)

      const source = audioCtx.createMediaStreamSource(stream)
      const worklet = new AudioWorkletNode(audioCtx, 'tab-pcm-sender')

      worklet.port.onmessage = (e) => {
        if (window.noteAISendTrackAudio) {
          window.noteAISendTrackAudio(e.data.samples, 'mixed-tab')
        }
      }

      source.connect(worklet)

      //Step1 to get user's name
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.3
      source.connect(analyser)
      window.__noteAIAnalyser = analyser
      window.__noteAIAnalyserData = new Float32Array(analyser.fftSize)

      // Don't connect to destination — avoids echo loop
      const silent = audioCtx.createGain()
      silent.gain.value = 0
      worklet.connect(silent).connect(audioCtx.destination)

      if (window.noteAISendTrackInfo) {
        window.noteAISendTrackInfo('mixed-tab', 'mixed')
      }

      window.__noteAITabCaptureActive = true
      console.log('[NoteAI] Tab audio capture started @ 16kHz')

      // Step 2 for username
      startSpeakerDetection()

      audioTrack.onended = () => {
        console.log('[NoteAI] Tab audio capture ended')
        window.__noteAITabCaptureActive = false
      }
    } catch (err) {
      console.error('[NoteAI] Tab audio capture failed:', err?.message || err)
    }
  }

  window.__startNoteAITabCapture = startTabAudioCapture
  console.log('[NoteAI] Tab capture module loaded ✓')

    // ── Step 3: Active-speaker DOM tracking ───────────────────────────────────
  // Zoom gives us one mixed audio stream, so Deepgram diarization produces
  // anonymous SPEAKER_0 / SPEAKER_1 labels. We watch Zoom's active-speaker
  // DOM highlight and emit speaker_start/speaker_end events with real names.
  // The backend SpeakerCorrelator time-correlates these with Deepgram segments
  // to assign permanent label→name mappings.

  const SPEAK_THRESHOLD = 0.005   // RMS VAD threshold
  const SPEAKER_POLL_MS = 300
  const speakingNow = new Map()   // name → startMs

  function sendEvent (payload) {
    if (window.noteAISendEvent) window.noteAISendEvent(JSON.stringify(payload))
  }

  // function getActiveSpeakerFromDOM () {
  //   const selectors = [
  //     '[class*="speaker-active"] [class*="display-name"]',
  //     '[class*="active-speaker"] [class*="display-name"]',
  //     '.speaker-active-container__display-name',
  //     '[class*="speaking"] [class*="display-name"]',
  //     '[class*="speaking"] [class*="name"]',
  //     '[aria-label*="is speaking" i]',
  //   ]
  //   for (const sel of selectors) {
  //     const el = document.querySelector(sel)
  //     const name = el?.textContent?.trim()
  //     if (name && name.length > 1 && !/^note|recorder/i.test(name)) return name
  //   }
  //   return null
  // }

  function getActiveSpeakerFromDOM () {
    // Strategy 1 (PRIMARY, verified): Zoom puts the current active speaker
    // inside .speaker-active-container__wrap. The name lives in
    // .video-avatar__avatar-footer > span. Works for both video-on and
    // video-off participants — this is the deterministic signal.
    const primary = document.querySelector(
      '.speaker-active-container__wrap .video-avatar__avatar-footer span'
    )
    const primaryName = primary?.textContent?.trim()
    if (primaryName && primaryName.length > 1 && !/^note|recorder/i.test(primaryName)) {
      return primaryName
    }

    // Strategy 2 (fallback): older "speaker-active" / "active-speaker" classes
    // on some Zoom builds.
    const explicitSelectors = [
      '[class*="speaker-active"] [class*="display-name"]',
      '[class*="active-speaker"] [class*="display-name"]',
      '.speaker-active-container__display-name',
      '[class*="speaking"] [class*="display-name"]',
      '[class*="speaking"] [class*="name"]',
      '[aria-label*="is speaking" i]',
    ]
    for (const sel of explicitSelectors) {
      const el = document.querySelector(sel)
      const name = el?.textContent?.trim()
      if (name && name.length > 1 && !/^note|recorder/i.test(name)) return name
    }

    // Strategy 3 (last-resort heuristic): duplicate-tile.
    // If neither container exists, fall back to detecting whose avatar tile
    // appears twice in the gallery (main stage + grid).
    const counts = new Map()
    document.querySelectorAll('.video-avatar__avatar-name').forEach(el => {
      const name = (el.textContent || '').replace(/\s*\([^)]*\)\s*$/, '').trim()
      if (!name || /^note|recorder/i.test(name)) return
      counts.set(name, (counts.get(name) || 0) + 1)
    })
    let best = null, bestCount = 1
    for (const [name, n] of counts) {
      if (n > bestCount) { bestCount = n; best = name }
    }
    return best
  }


  function getAudioLevel () {
    const a = window.__noteAIAnalyser
    const d = window.__noteAIAnalyserData
    if (!a || !d) return 0
    a.getFloatTimeDomainData(d)
    let sum = 0
    for (let i = 0; i < d.length; i++) sum += d[i] * d[i]
    return Math.sqrt(sum / d.length)
  }

  // function checkSpeakers () {
  //   const rms = getAudioLevel()
  //   if (rms >= SPEAK_THRESHOLD) {
  //     const name = getActiveSpeakerFromDOM()
  //     if (name && !speakingNow.has(name)) {
  //       const startMs = Date.now()
  //       speakingNow.set(name, startMs)
  //       sendEvent({ type: 'speaker_start', name, startMs })
  //       console.log('[NoteAI] Speaker start:', name, 'rms:', rms.toFixed(4))
  //     }
  //   } else {
  //     for (const [name] of speakingNow) {
  //       speakingNow.delete(name)
  //       sendEvent({ type: 'speaker_end', name, endMs: Date.now() })
  //       console.log('[NoteAI] Speaker end:', name)
  //     }
  //   }
  // }

  const SILENCE_HOLD_MS = 700   // wait this long after silence before firing speaker_end

  function checkSpeakers () {
    const rms = getAudioLevel()
    const now = Date.now()

    // Voice detected → fire speaker_start (once) and refresh lastVoiceMs
    if (rms >= SPEAK_THRESHOLD) {
      const name = getActiveSpeakerFromDOM()
      if (name) {
        if (!speakingNow.has(name)) {
          speakingNow.set(name, { startMs: now, lastVoiceMs: now })
          sendEvent({ type: 'speaker_start', name, startMs: now })
          console.log('[NoteAI] Speaker start:', name, 'rms:', rms.toFixed(4))
        } else {
          speakingNow.get(name).lastVoiceMs = now
        }
      }
    }

    // Always check whether any active speaker has been silent long enough
    // to count as "stopped" — runs every tick regardless of current rms.
    for (const [name, state] of speakingNow) {
      if (now - state.lastVoiceMs >= SILENCE_HOLD_MS) {
        speakingNow.delete(name)
        sendEvent({ type: 'speaker_end', name, endMs: now })
        console.log('[NoteAI] Speaker end:', name)
      }
    }
  }


  function startSpeakerDetection () {
    setInterval(checkSpeakers, SPEAKER_POLL_MS)
    console.log('[NoteAI] Speaker detection started ✓')
  }
})()
