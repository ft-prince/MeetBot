"""
MeetMaster — AIKosh / AI4Bharat IndicConformer transcription sidecar

Receives raw 16kHz Int16 PCM audio over WebSocket, transcribes in fixed chunks
using the AI4Bharat IndicConformer-600M multilingual model, and returns JSON
transcript segments using the SAME protocol as whisper_service.py so the existing
WhisperClient / aikoshClient contract is unchanged:

    in :  binary Int16 PCM @ 16kHz
    out:  {"type":"transcript","text":..,"start_ms":..,"end_ms":..,"speaker":..}

Model: ai4bharat/indic-conformer-600m-multilingual  (gated — needs HF_TOKEN)
Decoding: CTC (fast) or RNNT (more accurate). Language fixed via AIKOSH_LANG.

Run:
    HF_TOKEN=hf_xxx .venv/bin/python aikosh_service.py
"""

import asyncio
import json
import os
import time

import numpy as np
import torch
import websockets

HOST = "localhost"
PORT = int(os.environ.get("AIKOSH_PORT", "3003"))

SAMPLE_RATE = 16_000
# Real-time: small chunks → low latency. IndicConformer infers a 2.5s buffer in
# ~0.1s on MPS, so a 2.5s chunk gives ~2.5s end-to-end latency with good context.
CHUNK_SECONDS = float(os.environ.get("AIKOSH_CHUNK_SECONDS", "2.5"))
CHUNK_SAMPLES = int(SAMPLE_RATE * CHUNK_SECONDS)
# 0.6s overlap so a word cut at a chunk boundary is fully re-captured by the next
# window. Combined with dropping the trailing (likely-cut) word on full chunks
# and word-level dedup, this removes boundary truncation + duplication.
OVERLAP_SAMPLES = int(SAMPLE_RATE * 0.6)
# Flush a trailing partial buffer this long after the last audio frame, so the
# final words of an utterance aren't held hostage waiting for a full chunk.
FLUSH_AFTER_MS = int(os.environ.get("AIKOSH_FLUSH_AFTER_MS", "800"))
MIN_FLUSH_SAMPLES = int(SAMPLE_RATE * 0.5)  # don't bother transcribing <0.5s tails

MODEL_ID = os.environ.get("AIKOSH_MODEL", "ai4bharat/indic-conformer-600m-multilingual")
LANG = os.environ.get("AIKOSH_LANG", "hi")        # Indic language code
DECODING = os.environ.get("AIKOSH_DECODING", "ctc")  # "ctc" (fast) | "rnnt" (accurate)

# Skip near-silent chunks — RMS below this (on float32 [-1,1]) is treated as silence
SILENCE_RMS = float(os.environ.get("AIKOSH_SILENCE_RMS", "0.005"))

DEVICE = "cuda" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu")

# ── Load model ──────────────────────────────────────────────────────────────
print(f"[aikosh] Loading {MODEL_ID}  device={DEVICE}  decoding={DECODING}  lang={LANG}")
_t0 = time.time()
from transformers import AutoModel

model = AutoModel.from_pretrained(MODEL_ID, trust_remote_code=True)
try:
    model = model.to(DEVICE)
except Exception as e:  # some custom models pin their own device internally
    print(f"[aikosh] .to({DEVICE}) not supported ({e}); using model default device")
print(f"[aikosh] Model ready in {time.time() - _t0:.1f}s ✓")


def _transcribe(audio_f32: np.ndarray) -> str:
    """Run IndicConformer on a float32 [-1,1] mono buffer. Returns plain text."""
    wav = torch.from_numpy(audio_f32).unsqueeze(0)  # [1, N]
    try:
        wav = wav.to(DEVICE)
    except Exception:
        pass
    with torch.no_grad():
        out = model(wav, LANG, DECODING)
    # IndicConformer returns a str (or list[str]); normalise to a single string.
    if isinstance(out, (list, tuple)):
        return " ".join(str(x) for x in out).strip()
    return str(out).strip()


def _dedup(prev_tail: str, text: str) -> str:
    """Drop a leading word-run of `text` that repeats the trailing words of the
    previously emitted segment — removes the boundary duplication caused by the
    overlap window (e.g. prev "…रियल टाइम ट्रांस" + new "ट्रांस टेस्ट" → "टेस्ट")."""
    if not prev_tail:
        return text
    prev_words = prev_tail.split()
    new_words = text.split()
    max_k = min(len(prev_words), len(new_words))
    for k in range(max_k, 0, -1):
        if prev_words[-k:] == new_words[:k]:
            return " ".join(new_words[k:]).strip()
    return text


async def _emit(websocket, audio_chunk: np.ndarray, start_ms: int, dur_ms: int,
                prev_tail: str, is_flush: bool = False) -> str:
    """Transcribe a buffer, dedup against the previous tail, emit if non-empty.
    On a full chunk (not a flush) the trailing word is dropped — it is likely cut
    mid-word at the boundary and will be re-captured by the next overlap window.
    Returns the new tail (last few words) for the next call's dedup."""
    audio_f32 = audio_chunk.astype(np.float32) / 32768.0
    rms = float(np.sqrt(np.mean(audio_f32 ** 2)))
    if rms < SILENCE_RMS:
        return prev_tail
    try:
        text = await asyncio.get_event_loop().run_in_executor(
            None, _transcribe, audio_f32
        )
    except Exception as e:
        print(f"[aikosh] Transcribe error: {e}")
        return prev_tail
    text = _dedup(prev_tail, text)
    # Hold back the trailing (boundary-cut) word on full chunks; the overlap
    # window re-captures it whole in the next emit. Flush emits keep everything.
    if not is_flush:
        words = text.split()
        if len(words) > 1:
            text = " ".join(words[:-1])
    if not text:
        return prev_tail
    payload = {
        "type": "transcript",
        "text": text,
        "start_ms": start_ms,
        "end_ms": start_ms + dur_ms,
        "speaker": "SPEAKER_0",
        "confidence": None,
        "language": LANG,
        "words": [],
    }
    await websocket.send(json.dumps(payload))
    print(f"[aikosh] [{LANG}] → {text[:70]}")
    # Keep the last 6 words as the dedup window for the next segment
    return " ".join(text.split()[-6:])


async def handle_client(websocket):
    remote = websocket.remote_address
    print(f"[aikosh] Client connected: {remote}")

    buffer = np.array([], dtype=np.int16)
    elapsed_ms = 0
    prev_tail = ""

    try:
        while True:
            # Wait for the next audio frame, but only up to FLUSH_AFTER_MS so a
            # trailing partial buffer (end of an utterance) still gets flushed.
            try:
                message = await asyncio.wait_for(
                    websocket.recv(), timeout=FLUSH_AFTER_MS / 1000
                )
            except asyncio.TimeoutError:
                # Idle gap → flush whatever partial audio we have (real-time tail)
                if len(buffer) >= MIN_FLUSH_SAMPLES:
                    prev_tail = await _emit(websocket, buffer, elapsed_ms,
                                            int(len(buffer) / SAMPLE_RATE * 1000),
                                            prev_tail, is_flush=True)
                    elapsed_ms += int(len(buffer) / SAMPLE_RATE * 1000)
                    buffer = np.array([], dtype=np.int16)
                continue

            if not isinstance(message, bytes):
                continue

            chunk = np.frombuffer(message, dtype=np.int16)
            buffer = np.concatenate([buffer, chunk])

            # Emit every full CHUNK_SAMPLES window (keep a small overlap tail)
            while len(buffer) >= CHUNK_SAMPLES:
                audio_chunk = buffer[:CHUNK_SAMPLES]
                buffer = buffer[CHUNK_SAMPLES - OVERLAP_SAMPLES:]
                prev_tail = await _emit(websocket, audio_chunk, elapsed_ms,
                                        int(CHUNK_SECONDS * 1000), prev_tail)
                elapsed_ms += int(CHUNK_SECONDS * 1000)

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        print(f"[aikosh] Client disconnected: {remote}")


async def main():
    print(f"[aikosh] Listening on ws://{HOST}:{PORT}")
    async with websockets.serve(handle_client, HOST, PORT, max_size=None):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
