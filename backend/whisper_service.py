"""
MeetMaster — WhisperX transcription sidecar
Receives raw 16kHz Int16 PCM audio over WebSocket, transcribes in 5s chunks,
returns JSON transcript segments with word-level timestamps.

Install:
  pip install whisperx

Run:
  python whisper_service.py
"""

import asyncio
import json
import numpy as np
import websockets
import os

HOST = "localhost"
PORT = 3002
SAMPLE_RATE    = 16_000
CHUNK_SECONDS  = 5
CHUNK_SAMPLES  = SAMPLE_RATE * CHUNK_SECONDS
OVERLAP_SAMPLES = SAMPLE_RATE // 2   # 0.5s overlap to avoid cutting words

# ── Model config ──────────────────────────────────────────────────────────────
# Set to a local folder path (e.g. "./whisper_base") if you downloaded manually,
# or a model name ("tiny", "base", "small", "medium") to auto-download.
MODEL_PATH   = "./whisper_tiny"   # folder name — contains base model files
DEVICE       = "cpu"
COMPUTE_TYPE  = "int8"       # int8 = fastest on CPU, no quality loss vs float32
ALIGN_WORDS   = False        # word-level timestamps — set True only if needed (downloads ~1.3 GB)

# Only accept these languages — anything else gets re-transcribed as Hindi
# (prevents false detections like Welsh, Latin, etc. on Indian-accented audio)
ALLOWED_LANGS = {"en", "hi"}

# ── Load model ────────────────────────────────────────────────────────────────
import whisperx

# If the folder doesn't exist, fall back to model name string (whisperx downloads it)
# e.g. "./whisper_base" → "base",  "./whisper_small" → "small"
if os.path.isdir(MODEL_PATH):
    model_arg = MODEL_PATH
else:
    model_arg = os.path.basename(MODEL_PATH).replace("whisper_", "").replace("faster-whisper-", "")

print(f"[whisper] Loading WhisperX model: {model_arg}  device={DEVICE}  compute={COMPUTE_TYPE}")
model = whisperx.load_model(
    model_arg,
    device=DEVICE,
    compute_type=COMPUTE_TYPE,
    language=None,           # auto-detect per chunk (English / Hindi / Hinglish)
)
print("[whisper] Model ready ✓")

# Alignment model cache: language_code → (align_model, metadata)
# Loaded on-demand the first time a language is seen.
align_models: dict = {}


def get_align_model(language: str):
    """Lazy-load the phoneme alignment model for a given language."""
    if language not in align_models:
        try:
            am, meta = whisperx.load_align_model(language_code=language, device=DEVICE)
            align_models[language] = (am, meta)
            print(f"[whisper] Alignment model loaded for '{language}'")
        except Exception as e:
            print(f"[whisper] No alignment model for '{language}': {e}")
            align_models[language] = None
    return align_models[language]


# ── Per-client handler ────────────────────────────────────────────────────────

async def handle_client(websocket):
    remote = websocket.remote_address
    print(f"[whisper] Client connected: {remote}")

    buffer      = np.array([], dtype=np.int16)
    elapsed_ms  = 0

    try:
        async for message in websocket:
            if not isinstance(message, bytes):
                continue

            chunk  = np.frombuffer(message, dtype=np.int16)
            buffer = np.concatenate([buffer, chunk])

            if len(buffer) < CHUNK_SAMPLES:
                continue

            audio_chunk = buffer[:CHUNK_SAMPLES]
            buffer      = buffer[CHUNK_SAMPLES - OVERLAP_SAMPLES:]

            # Int16 → Float32 [-1, 1]
            audio_f32 = audio_chunk.astype(np.float32) / 32768.0

            # ── Transcribe ──────────────────────────────────────────────────
            try:
                result = await asyncio.get_event_loop().run_in_executor(
                    None, _transcribe, audio_f32
                )
            except Exception as e:
                print(f"[whisper] Transcribe error: {e}")
                elapsed_ms += CHUNK_SECONDS * 1000
                continue

            language = result.get("language", "?")
            segments = result.get("segments", [])

            if not segments:
                elapsed_ms += CHUNK_SECONDS * 1000
                continue

            # ── Align (word-level timestamps) — disabled by default ─────────
            if ALIGN_WORDS:
                align_result = get_align_model(language)
                if align_result:
                    try:
                        am, meta = align_result
                        aligned = await asyncio.get_event_loop().run_in_executor(
                            None,
                            lambda: whisperx.align(
                                segments, am, meta, audio_f32,
                                device=DEVICE, return_char_alignments=False
                            )
                        )
                        segments = aligned.get("segments", segments)
                    except Exception as e:
                        print(f"[whisper] Align error (using unaligned): {e}")

            # ── Emit results ─────────────────────────────────────────────────
            for seg in segments:
                text = (seg.get("text") or "").strip()
                if not text:
                    continue

                # Word-level timestamps if available
                words = [
                    {
                        "word":    w.get("word", ""),
                        "start_ms": elapsed_ms + int(w.get("start", 0) * 1000),
                        "end_ms":   elapsed_ms + int(w.get("end",   0) * 1000),
                    }
                    for w in seg.get("words", [])
                ]

                payload = {
                    "type":       "transcript",
                    "text":       text,
                    "start_ms":   elapsed_ms + int(seg.get("start", 0) * 1000),
                    "end_ms":     elapsed_ms + int(seg.get("end",   0) * 1000),
                    "speaker":    "SPEAKER_0",
                    "confidence": float(seg.get("avg_logprob", 0)),
                    "language":   language,
                    "words":      words,
                }

                await websocket.send(json.dumps(payload))
                print(f"[whisper] [{language}] → {text[:70]}")

            elapsed_ms += CHUNK_SECONDS * 1000

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        print(f"[whisper] Client disconnected: {remote}")


def _transcribe(audio_f32: np.ndarray) -> dict:
    """Run in executor so it doesn't block the event loop."""
    result = model.transcribe(
        audio_f32,
        batch_size=8,
        language=None,      # auto-detect first
        task="transcribe",
    )

    detected = result.get("language", "en")

    # If whisper guessed a language outside our allowed set (e.g. Welsh, Latin),
    # re-run forced to Hindi — most likely language for Indian-accented audio.
    if detected not in ALLOWED_LANGS:
        print(f"[whisper] Rejected language '{detected}', re-transcribing as Hindi")
        result = model.transcribe(
            audio_f32,
            batch_size=8,
            language="hi",
            task="transcribe",
        )

    return result


# ── Main ──────────────────────────────────────────────────────────────────────

async def main():
    print(f"[whisper] Listening on ws://{HOST}:{PORT}")
    async with websockets.serve(handle_client, HOST, PORT):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
