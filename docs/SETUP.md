# NoteAI — First-Time Setup Guide

How to install and run NoteAI on a fresh machine (new PC / server / location).
Covers the in-house AIKosh Indic STT path.

> Tested on macOS (Apple Silicon, MPS) and Linux. On Linux/NVIDIA the AIKosh
> sidecar uses CUDA automatically; on Mac it uses MPS; otherwise CPU.

---

## 0. Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 20.x | `node -v` → v20+ |
| Python | 3.11 | for the STT sidecars |
| PostgreSQL | 14+ | local or remote |
| Google Chrome | latest stable | the meeting bots drive real Chrome |
| ffmpeg (optional) | — | only for generating test audio |
| Git | — | to clone |
| RAM/Disk | 8 GB+ RAM, ~3 GB free | IndicConformer model ≈ 2 GB |

A **HuggingFace account** is required (the AIKosh model is gated).

---

## 1. Clone

```bash
git clone <repo-url> noteAI
cd noteAI
```

Repo layout:
```
noteAI/
  backend/    Express + ws API, bots, STT sidecars (Python)
  frontend/   Vite + React UI
  docs/       this guide, design + flow docs
```

---

## 2. PostgreSQL

Create the database, then run migrations (loads `backend/src/db/schema.sql`).

```bash
# create a db named "noteai" (adjust user/password to your setup)
createdb noteai          # or: psql -c "CREATE DATABASE noteai;"
```

---

## 3. Backend — Node

```bash
cd backend
npm install
npx playwright install chromium     # browser engine for the bots
```

Create `backend/.env` from the template and fill it in:

```bash
cp .env.example .env
```

Minimum required keys:
```bash
PORT=8001
DATABASE_URL=postgresql://<user>:<pass>@localhost:5432/noteai
SESSION_SECRET=<random-string>

# In-house STT
STT_ENGINE=aikosh
AIKOSH_STT_URL=ws://localhost:3003
HF_TOKEN=hf_xxx                 # see step 5
AIKOSH_LANG=hi
AIKOSH_DECODING=ctc

# Google sign-in (for app login + bot OAuth). Create at console.cloud.google.com
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://127.0.0.1:8001/accounts/google/login/callback/

# AI summary (post-meeting). Get a key at console.groq.com
GROQ_API_KEY=...
```

Run DB migrations:
```bash
npm run db:migrate
```

---

## 4. STT sidecar — Python

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

> First `torch` install can be large (~1–2 GB). On Linux+NVIDIA, install the CUDA
> build of torch from pytorch.org if you want GPU.

---

## 5. AIKosh model access (gated, one-time)

1. Create a HuggingFace **read token**: https://huggingface.co/settings/tokens
2. Accept the model license (must be logged in):
   https://huggingface.co/ai4bharat/indic-conformer-600m-multilingual → **Agree and access**
3. Put the token in `backend/.env`: `HF_TOKEN=hf_xxx`

The ~2 GB model downloads on first sidecar start (cached in `~/.cache/huggingface`).

---

## 6. Bot login profiles (one-time, per platform)

The bots join meetings as a **signed-in** account (guest joins get blocked by
org-restricted meetings). Run the login script once per platform — a Chrome
window opens, you sign in manually, then press **Ctrl+C** to save the session.

```bash
cd backend
npx tsx scripts/bot-login.ts        # Google Meet  → ~/.noteai/bot-profile
npx tsx scripts/zoom-login.ts       # Zoom         → ~/.noteai/zoom-bot-profile
npx tsx scripts/teams-login.ts      # Teams        → ~/.noteai/teams-bot-profile
```

Use an account that has access to the meetings you'll record.

---

## 7. Frontend

```bash
cd frontend
npm install
```

The Vite dev server proxies `/api`, `/auth`, `/panel` → `http://localhost:8001`
(see `frontend/vite.config.ts`), so no extra config is needed for local dev.

---

## 8. Run (3 processes)

```bash
# Terminal 1 — AIKosh STT sidecar (wait for: Listening on ws://localhost:3003)
cd backend
export HF_TOKEN=$(grep '^HF_TOKEN=' .env | cut -d= -f2)
export HUGGING_FACE_HUB_TOKEN="$HF_TOKEN" AIKOSH_DECODING=ctc AIKOSH_LANG=hi
.venv/bin/python aikosh_service.py

# Terminal 2 — Backend (wait for: NoteAI backend running on port 8001)
cd backend
npm run dev

# Terminal 3 — Frontend
cd frontend
npm run dev        # → http://localhost:5173
```

Open **http://localhost:5173**, sign in with Google, go to **Live Recording**,
paste a meeting link, click **Start Recording**, and admit the bot from the host
side. Transcripts stream live; the summary generates when you click **Stop**.

---

## 9. Verify the install (no meeting needed)

```bash
cd backend
# generate a 16kHz test clip (macOS):
say "this is a test" -o /tmp/t.aiff && afconvert -f WAVE -d LEI16@16000 -c 1 /tmp/t.aiff /tmp/test_16k.wav
# stream it through the real backend → AIKosh → DB:
npx tsx scripts/test-aikosh-e2e.ts /tmp/test_16k.wav
# expect: ✅ PASS — N segment(s) transcribed via AIKosh + saved to DB
```

---

## 10. Production build (optional)

```bash
cd frontend && npm run build          # outputs to frontend/dist (served by backend)
cd ../backend && npm run build && npm start
```

Keep the AIKosh sidecar (`aikosh_service.py`) running alongside `npm start`.

---

## 11. Switching STT engines

In `backend/.env`, set `STT_ENGINE` then restart the backend:
- `aikosh` — in-house Indic (default, needs the sidecar + HF_TOKEN)
- `whisper` — local WhisperX (`python whisper_service.py` on :3002)
- `deepgram` — cloud (needs `DEEPGRAM_API_KEY`)

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `GatedRepoError / 401` on model load | Accept the license (step 5) + valid `HF_TOKEN`. |
| Sidecar slow to start | First load is ~40 s (cached) / longer on first download. |
| Bot "can't join this video call" | Re-run the platform login script with an account that has access. |
| Bot leaves immediately | Ensure it was admitted; `BOT_JOIN_TIMEOUT` (sec) controls lobby wait. |
| No transcripts in DB | Confirm sidecar on :3003 and `STT_ENGINE=aikosh`; check backend log for `Connecting to STT service at ws://localhost:3003`. |
| `torch` won't install | Use Python 3.11; on Linux/GPU install the CUDA torch wheel from pytorch.org. |

See also: `docs/AIKOSH_STT_DESIGN.md` (design) and `docs/ARCHITECTURE_FLOW.md` (ports + flow).
