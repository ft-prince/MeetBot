# NoteAI — Backend

Express + TypeScript service that runs the meeting bot, ingests per-speaker audio, brokers transcription via Whisper, persists everything to PostgreSQL, and generates AI summaries with Groq.

For the monorepo overview see [../README.md](../README.md). For the React dashboard see [../frontend/README.md](../frontend/README.md).

---

## Table of Contents

1. [Architecture](#architecture)
2. [Prerequisites](#prerequisites)
3. [Installation](#installation)
4. [Configuration](#configuration)
5. [Running the App](#running-the-app)
6. [Google OAuth Setup](#google-oauth-setup)
7. [Database Setup](#database-setup)
8. [Whisper Sidecar](#whisper-sidecar)
9. [How It Works](#how-it-works)
10. [API Reference](#api-reference)
11. [Project Structure](#project-structure)
12. [Troubleshooting](#troubleshooting)

---

## Architecture

```
                     ┌──────────────────────────────────────────┐
                     │  Express (port 8001)                     │
                     │                                          │
React frontend ───▶  │  /auth   Google OAuth                    │
(5173 in dev,        │  /api    REST: meetings, calendar, bots  │  ──▶ PostgreSQL
8001 in prod)        │  /panel  WS: live transcript events      │
                     │                                          │
                     │  MeetBot (Playwright/Chromium)           │
                     │   └─ audioInjector.js                    │
                     │      └─ per-track PCM ──▶ Whisper (3002) │
                     └──────────────────────────────────────────┘
```

The bot launches a real Chromium, navigates to the Meet URL, intercepts each WebRTC audio track via an injected script, and forwards raw 16 kHz Int16 PCM to a self-hosted Whisper WebSocket. Transcript segments flow back through a `SpeakerCorrelator` (which matches Whisper output to DOM speaker events) and are broadcast to any panel WebSocket clients listening for that meeting.

---

## Prerequisites

- **Node.js** 18+
- **PostgreSQL** 14+
- **Google Chrome** installed (Playwright uses the system `chrome` channel)
- **Python 3.10+** with `whisperx` installed if you want to run the bundled Whisper sidecar (`whisper_service.py`)
- **Groq API key** — free at [console.groq.com](https://console.groq.com)
- **Google Cloud project** with OAuth 2.0 credentials and the Calendar API enabled

---

## Installation

```bash
cd backend
npm install
```

---

## Configuration

```bash
cp .env.example .env
```

### Environment Variables

| Variable | Description | Example |
|---|---|---|
| `PORT` | Express listen port | `8001` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://localhost/noteai` |
| `SESSION_SECRET` | Random secret for session cookies | `change-me-in-production` |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 client ID | `760653...apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 client secret | `GOCSPX-...` |
| `GOOGLE_REDIRECT_URI` | Must exactly match the URI registered in Google Cloud Console | `http://localhost:8001/accounts/google/login/callback/` |
| `GROQ_API_KEY` | Groq API key for AI summaries | `gsk_...` |
| `WHISPER_URL` | WebSocket URL of the Whisper transcription server | `ws://localhost:3002` |
| `BOT_GOOGLE_EMAIL` | *(Optional)* Google account the bot signs in as | `bot@example.com` |
| `BOT_GOOGLE_PASSWORD` | *(Optional)* Password for the bot account | |
| `BOT_CHROME_PROFILE_DIR` | *(Optional)* Pre-authenticated Chrome profile path | `/tmp/noteai-bot-profile` |

Without `DATABASE_URL` the backend will still boot and the live dashboard will work, but transcripts and meetings will not be persisted.

---

## Running the App

### Development (auto-reload)

```bash
npm run dev
```

The backend listens on `http://localhost:8001`. In this mode the React frontend should run separately on Vite's dev server — see [../frontend/README.md](../frontend/README.md).

### Production-style (single port)

```bash
# Build the frontend first so it can be served as static files
cd ../frontend && npm run build

# Build and start the backend
cd ../backend
npm run build
node dist/index.js
```

The backend checks for `../frontend/dist/index.html` and serves it from `/`. If the React build isn't present it falls back to the legacy vanilla frontend at `backend/frontend-vanilla/`.

Open **http://localhost:8001**.

---

## Google OAuth Setup

1. Open [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services → Credentials**
2. Create an **OAuth 2.0 Client ID** of type *Web application*
3. Add this exact URI under **Authorised redirect URIs**:
   ```
   http://localhost:8001/accounts/google/login/callback/
   ```
4. Enable the **Google Calendar API** in **APIs & Services → Library**
5. Copy the Client ID and Secret into `backend/.env`

> **Error: "Sign-in failed: invalid state"** — the `GOOGLE_REDIRECT_URI` in your `.env` does not match the URI registered in Google Cloud. They must be byte-identical, trailing slash included.

When the React app is being served by Vite on port 5173, OAuth still completes through port 8001 (because that's the registered redirect target). After signing in, you'll land back on the backend; navigate to `http://localhost:5173` and the session cookie is shared on `localhost`.

---

## Database Setup

```bash
createdb noteai
psql noteai < src/db/schema.sql
```

The schema is idempotent — safe to re-run.

| Table | Purpose |
|---|---|
| `users` | Google OAuth profiles + access/refresh tokens |
| `session` | Express session store (managed by `connect-pg-simple`) |
| `meetings` | Meeting records, including AI summary fields |
| `calendar_events` | Synced Google Calendar events |
| `transcript_segments` | Per-speaker transcript lines |
| `speakers` | Speaker label ↔ name mapping per meeting |
| `dom_speaker_events` | Raw speaker start/end events captured from the Meet DOM |

---

## Whisper Sidecar

Bundled in `whisper_service.py` — a WebSocket server that receives 16 kHz Int16 PCM and returns `{ type: "transcript", text, start_ms, end_ms, speaker, language }` messages.

```bash
pip install whisperx
python whisper_service.py
# Listens on ws://localhost:3002
```

If Whisper is not running the bot still joins meetings and the dashboard still renders, but no transcripts will appear. The backend reconnects automatically when Whisper comes back online.

---

## How It Works

### 1. Bot joins the meeting

1. Backend extracts the meeting code from the Meet URL (e.g. `abc-defg-hij`)
2. `botManager.launch()` creates an ingest session, then `MeetBot` launches Chromium
3. `audioInjector.js` is injected as an init script — it patches the WebRTC layer to intercept per-participant audio tracks
4. The bot fills the display name, mutes mic/camera, and clicks "Join now"

### 2. Live transcription

For each participant audio track:

- Raw PCM is forwarded over a per-track WebSocket to the Whisper sidecar
- Whisper returns final transcript segments
- `SpeakerCorrelator` matches segments to DOM speaker events (start/end times scraped from the Google Meet UI) to identify who said what
- Final segments are saved to PostgreSQL and broadcast to every connected `/panel` WebSocket subscribed to that meeting

### 3. Meeting ends

When the bot leaves or the user clicks **Stop**:

1. All Whisper clients disconnect
2. `ended_at` and `duration_ms` are written to the `meetings` row
3. A `meeting.ended` event is broadcast on the panel WebSocket
4. AI summary generation runs in the background (non-blocking)

### 4. AI summary

The full transcript is sent to Groq (`llama-3.1-8b-instant`) with a structured prompt. The response is parsed into four sections (detailed rewrite, executive summary, key insights, important points) and saved to the `meetings` row.

The prompt understands Hinglish (Hindi + English) input and always responds in English.

---

## API Reference

All endpoints except `GET /api/health` require an authenticated session.

### Auth

| Method | Path | Description |
|---|---|---|
| `GET` | `/auth/google` | Start Google OAuth flow |
| `GET` | `/accounts/google/login/callback/` | OAuth callback (registered with Google) |
| `GET` | `/auth/me` | Current user or `401` |
| `POST` | `/auth/logout` | Destroy session |
| `PATCH` | `/auth/settings` | Update `autoJoinMinutes` |

### Meetings

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/meetings` | List the signed-in user's meetings |
| `POST` | `/api/meetings/join` | Launch bot for a Meet URL |
| `POST` | `/api/meetings/:code/stop` | Gracefully stop bot + generate summary |
| `POST` | `/api/meetings/:code/exit` | Force-kill bot, no summary |
| `GET` | `/api/meetings/:id/transcript` | Transcript segments for a meeting |
| `GET` | `/api/meetings/:id/summary` | Summary + insights for a meeting |
| `GET` | `/api/bots/active` | List active bot meeting codes |

### Calendar

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/calendar/sync` | Pull events from Google Calendar into DB |
| `GET` | `/api/calendar/events` | List upcoming calendar events |
| `PATCH` | `/api/calendar/events/:id/auto-join` | Toggle auto-join for an event |

### WebSocket

| Path | Direction | Description |
|---|---|---|
| `/panel?meetingId=<code>` | Server → Client | Live transcript events, bot status |
| `/audio?meetingId=<code>` | Client → Server | Raw PCM audio (legacy browser-extension path) |

---

## Project Structure

```
backend/
├── src/
│   ├── bot/
│   │   ├── meetBot.ts          Playwright bot — joins Meet, captures audio
│   │   ├── botManager.ts       Manages active bot instances
│   │   └── audioInjector.js    Injected into Chrome — WebRTC track intercept
│   ├── db/
│   │   ├── client.ts           PostgreSQL pool
│   │   └── schema.sql          Idempotent schema (run to initialise DB)
│   ├── routes/
│   │   ├── auth.ts             Google OAuth + session endpoints
│   │   ├── api.ts              Meeting + bot REST endpoints
│   │   └── calendar.ts         Calendar sync + auto-join endpoints
│   ├── services/
│   │   ├── googleAuth.ts       OAuth client, token exchange, user upsert
│   │   ├── calendarService.ts  Google Calendar API calls
│   │   ├── meetingService.ts   DB queries for meetings + transcripts
│   │   ├── schedulerService.ts Auto-join cron (checks every 60s)
│   │   ├── speakerCorrelator.ts Matches Whisper segments → speaker names
│   │   └── summaryService.ts   Groq AI summary generation
│   ├── types/
│   │   └── session.d.ts        express-session type augmentation
│   ├── ws/
│   │   ├── ingestHandler.ts    WebSocket session management
│   │   └── whisperClient.ts    WebSocket client for the Whisper sidecar
│   ├── config.ts               Reads .env into a typed config object
│   └── index.ts                Express entry point
├── whisper_service.py          Optional bundled Whisper sidecar
├── frontend-vanilla/           Legacy fallback UI (used if React build is missing)
├── .env.example                Template for .env
└── package.json
```

---

## Troubleshooting

### "Sign-in failed: invalid state"

`GOOGLE_REDIRECT_URI` in `.env` must exactly match the URI registered in Google Cloud Console. Use:

```
GOOGLE_REDIRECT_URI=http://localhost:8001/accounts/google/login/callback/
```

### Dashboard shows no data after sign-in

1. Confirm the backend is running on 8001: `curl http://localhost:8001/api/health` should return `{ "ok": true }`
2. In DevTools → Network, look at `/auth/me`. A `401` means the session cookie was not set — usually a redirect URI mismatch as above.

### Bot fails to join the meeting

- Ensure Google Chrome is installed (Playwright uses the system `chrome` channel)
- For org-restricted meetings, configure `BOT_CHROME_PROFILE_DIR` with a pre-signed-in profile
- Inspect backend logs for `[bot]` lines to see which step failed

### No AI summary generated

- Confirm `GROQ_API_KEY` is set
- Watch for `[summary]` lines in backend logs after the meeting ends
- The transcript must have at least 100 characters of text for summary generation to run

### Calendar sync returns no events

- Enable the **Google Calendar API** in your Google Cloud project
- Re-authenticate (sign out, sign back in) to refresh the token with the Calendar scope
- Only events that have a Google Meet link and a future start time are synced
