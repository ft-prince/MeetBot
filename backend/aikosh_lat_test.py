"""
Latency + correctness test for the AIKosh STT sidecar.
Streams a WAV as Int16 PCM (simulating the bot) and measures how long after
the final audio chunk the transcript arrives.

Run: .venv/bin/python aikosh_lat_test.py /tmp/test_16k.wav
"""
import asyncio
import json
import sys
import time

import numpy as np
import soundfile as sf
import websockets

URL = "ws://localhost:3003"
SEND_CHUNK_MS = 200  # how the bot streams audio (small frames)


async def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/test_16k.wav"
    data, sr = sf.read(path, dtype="int16")
    assert sr == 16000, f"expected 16kHz, got {sr}"
    print(f"[lat] {path}  {len(data)} samples  {len(data)/sr:.2f}s")

    frame = int(16000 * SEND_CHUNK_MS / 1000)
    async with websockets.connect(URL, max_size=None) as ws:
        results = []

        async def reader():
            async for msg in ws:
                obj = json.loads(msg)
                obj["_recv"] = time.time()
                results.append(obj)
                print(f"[lat] transcript @ {obj['_recv']:.2f}: {obj['text']!r}")

        rtask = asyncio.create_task(reader())

        t_start = time.time()
        for i in range(0, len(data), frame):
            await ws.send(data[i:i + frame].tobytes())
            await asyncio.sleep(SEND_CHUNK_MS / 1000)  # real-time pacing
        t_last_audio = time.time()
        print(f"[lat] finished streaming audio at +{t_last_audio - t_start:.2f}s")

        # Wait up to 15s for trailing transcripts
        try:
            await asyncio.wait_for(rtask, timeout=15)
        except asyncio.TimeoutError:
            pass

        if results:
            first = results[0]["_recv"] - t_start
            last = results[-1]["_recv"] - t_last_audio
            print(f"\n[lat] first transcript at +{first:.2f}s into stream")
            print(f"[lat] last transcript {last:+.2f}s after audio ended (lag)")
            print(f"[lat] total segments: {len(results)}")
            print("[lat] full text:", " ".join(r["text"] for r in results))
        else:
            print("[lat] ❌ NO transcripts received")


asyncio.run(main())
