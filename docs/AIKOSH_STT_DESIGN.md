# AIKosh In-House STT — Design Doc

**Status:** Implemented & verified live (2026-06-09)
**Scope:** Replace cloud Deepgram STT with a fully on-device Indic speech-to-text
engine (govt **AIKosh / AI4Bharat IndicConformer**), with real-time streaming
transcription. Plus reliability fixes to the meeting bot (join/leave/admit) and
the test harness.

---

## 1. Goal

- **In-house STT, no external API** for transcription — audio never leaves the machine.
- **Real-time** (~2–3 s latency) Hindi + code-mix transcription.
- **Pluggable**: switch engines (`deepgram` | `whisper` | `aikosh`) via one env var.
- Keep the existing capture → correlate → persist → summarize pipeline unchanged.

---

## 2. Architecture

```
 Google Meet (browser)
        │  per-participant audio tracks (Int16 PCM @16kHz)
        ▼
 MeetBot (Playwright, authenticated Google profile)        backend/src/bot/meetBot.ts
        │  onTrackAudio(chunk, trackId)
        ▼
 ingestHandler  ── createSttClient() ──┐                    backend/src/ws/ingestHandler.ts
        │                              │                    backend/src/ws/sttClient.ts
        │            STT_ENGINE switch │
        │      ┌───────────────────────┼───────────────────────┐
        │      ▼                       ▼                       ▼
        │  DeepgramClient        WhisperClient(:3002)    WhisperClient(:3003)
        │  (cloud, dormant)      WhisperX sidecar        AIKosh sidecar  ◄── default now
        │                                                     │
        │                                                     ▼
        │                                      aikosh_service.py (Python, MPS)
        │                                      AI4Bharat IndicConformer-600M
        │                                      PCM in → transcript JSON out
        ▼
 SpeakerCorrelator → saveSegment → Postgres (transcript_segments)
        │
        ▼
 Panel WebSocket (real-time UI)  +  AI summary pipeline (Groq) on stop
```

Key insight: **WhisperX and AIKosh share one wire protocol** (binary PCM in →
`{type:"transcript", text, start_ms, end_ms, speaker}` out), so a single
`WhisperClient` class serves both — only the URL differs. The STT engine is
selected by a factory, so `ingestHandler` stays engine-agnostic.

---

## 3. Components

| File | Role |
|------|------|
| `backend/aikosh_service.py` | Python WS sidecar (:3003). Loads IndicConformer, buffers PCM, streams transcripts. |
| `backend/src/ws/sttClient.ts` | `createSttClient()` factory → `deepgram` \| `whisper` \| `aikosh`. |
| `backend/src/ws/whisperClient.ts` | URL-configurable WS client (reused for WhisperX + AIKosh). |
| `backend/src/ws/ingestHandler.ts` | Uses `createSttClient()` at all 3 STT construction sites. |
| `backend/src/config.ts` | `sttEngine`, `aikoshSttUrl`. |
| `backend/scripts/test-aikosh-e2e.ts` | Streams a WAV through the real `/audio` WS → asserts DB segments. |
| `backend/aikosh_lat_test.py` | Measures streaming latency + boundary accuracy against the sidecar. |

---

## 4. Real-time streaming design

IndicConformer is **chunk-based**, not a true streaming model — each call
transcribes a full buffer. We approximate real-time with small windows:

- **Chunk = 2.5 s**, inference ≈ 0.1 s on MPS → ~2.5 s end-to-end latency.
- **Overlap = 0.6 s** so a word cut at a boundary is re-captured by the next window.
- **Trailing-word hold**: on a full chunk the last (likely-cut) word is dropped and
  re-emitted whole from the next overlap window.
- **Word-level dedup** removes repeated boundary words between consecutive segments.
- **Idle-flush**: 0.8 s after speech pauses, any partial buffer is flushed so the
  final words of an utterance emit immediately (no waiting for a full chunk).
- **Silence gate** (RMS threshold) skips empty chunks → no hallucinated tokens.

Tunables (env): `AIKOSH_CHUNK_SECONDS`, `AIKOSH_FLUSH_AFTER_MS`, `AIKOSH_LANG`,
`AIKOSH_DECODING` (`ctc` fast | `rnnt` accurate), `AIKOSH_SILENCE_RMS`.

---

## 5. Diarization

Speaker attribution is **STT-independent**, so swapping to AIKosh did not break it:
1. **Per-track separation (primary)** — the bot captures one audio stream per
   participant; one track = one speaker.
2. **DOM name binding** — the participant's display name is read from the Meet UI
   and bound to the track (`track_info`).
3. (Deepgram only) acoustic `diarize` — not available with AIKosh; not needed for
   per-track Meet capture. For mixed single-stream audio, add `pyannote.audio`.

---

## 6. Configuration

```bash
# backend/.env
STT_ENGINE=aikosh                 # deepgram | whisper | aikosh
AIKOSH_STT_URL=ws://localhost:3003
HF_TOKEN=hf_...                   # gated model — accept license on HF first
AIKOSH_LANG=hi
AIKOSH_DECODING=ctc
```

Model: `ai4bharat/indic-conformer-600m-multilingual` (gated; ~2 GB cached under
`~/.cache/huggingface`). Loads via `transformers` + `trust_remote_code`, no NeMo.

---

## 7. Reliability fixes (this session)

| Area | Problem | Fix |
|------|---------|-----|
| **Bot login** | Joined as guest → blocked by org-restricted meetings | `scripts/bot-login.ts` saves an authenticated Google profile (`~/.noteai/bot-profile`). |
| **Alone-detection** | Counted hover-only "More options for" buttons → false 0 when participants present but silent → bot left | Count participant **tiles** + people-count **badge**; leave only when truly alone for 2 min. |
| **Late admit** | Lobby wait capped at 5 min → admit after that failed | Configurable `BOT_JOIN_TIMEOUT` (default **15 min**). |
| **Summary on manual stop** | `test-bot-join.ts` called `process.exit()` → killed the fire-and-forget pipeline | Script now polls the DB for the summary before exiting. |
| **Boundary accuracy** | 5 s chunk dropped short audio; words cut/duplicated at boundaries | 2.5 s chunk + 0.6 s overlap + trailing-word hold + dedup + idle-flush. |

---

## 8. How to run

```bash
# 1. AIKosh STT sidecar (Terminal 1)
cd backend
export HF_TOKEN=$(grep '^HF_TOKEN=' .env | cut -d= -f2)
export HUGGING_FACE_HUB_TOKEN="$HF_TOKEN" AIKOSH_DECODING=ctc AIKOSH_LANG=hi
.venv/bin/python aikosh_service.py            # wait for: Listening on ws://localhost:3003

# 2. Backend (Terminal 2) — reads STT_ENGINE=aikosh
npx tsx watch src/index.ts

# 3a. Via UI: open http://localhost:5173/live → paste meeting link → Start Recording
# 3b. Via script: npx tsx scripts/test-bot-join.ts https://meet.google.com/xxx-xxxx-xxx
```

---

## 9. Testing

```bash
# Sidecar latency + boundary accuracy
.venv/bin/python aikosh_lat_test.py /tmp/test_16k.wav

# Full path through the real backend → DB (no browser needed)
npx tsx scripts/test-aikosh-e2e.ts /tmp/test_16k.wav
```

**Verified live (2026-06-09):** real Google Meet, Hindi speech, 14 segments
transcribed in real-time via AIKosh and persisted; AI summary generated.

---

## 10. Known limitations / future work

- **English rendered in Devanagari** — IndicConformer-Hindi transliterates English
  phonetically (e.g. "transcription" → "ट्रांसक्रिप्शन"). Accepted. Optional:
  post-process with `indic-transliteration` to restore Latin script for code-mix.
- **Minor boundary fragments** — rare sub-word artifacts on the idle-flush; word-dedup
  handles full-word repeats but not partial fragments.
- **Summary pipeline still cloud (Groq)** — only the post-meeting LLM summarization
  uses an external API; transcription is fully local. Swap to a local LLM (Ollama)
  for a 100% offline stack.
- **Single shared model instance** — concurrent tracks serialize through one model;
  fine for typical meetings, scale with a worker pool if needed.
```
