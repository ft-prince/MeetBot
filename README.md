# NoteAI

AI-powered meeting recorder for Google Meet. A bot joins your meeting, transcribes every speaker in real time, and generates a structured AI analysis when the call ends — all visible in a secure per-user dashboard.

---

## Table of Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Tech Stack](#tech-stack)
4. [Prerequisites](#prerequisites)
5. [Installation](#installation)
6. [Configuration](#configuration)
7. [Running the App](#running-the-app)
8. [Google OAuth Setup](#google-oauth-setup)
9. [Database Setup](#database-setup)
10. [How It Works](#how-it-works)
11. [AI Summary Breakdown](#ai-summary-breakdown)
12. [API Reference](#api-reference)
13. [Project Structure](#project-structure)
14. [Development Workflow](#development-workflow)
15. [Troubleshooting](#troubleshooting)

---

## Features

- **Google Sign-In** — OAuth 2.0 authentication; every user only sees their own data
- **Live Bot Recording** — Playwright-controlled Chrome joins Google Meet as "NoteAI Recorder"
- **Real-time Transcription** — per-speaker audio routed through OpenAI Whisper (self-hosted)
- **Speaker Identification** — DOM-scraping correlates participant names to audio tracks
- **AI Analysis** — Groq (Llama 3.1) generates four sections after the meeting ends:
  - Detailed narrative rewrite
  - Executive summary
  - Key insights & action items
  - Important points / facts
- **Calendar Integration** — sync Google Calendar; auto-join meetings N minutes before start
- **Secure Dashboard** — protected routes; unauthenticated users are redirected to sign-in

---

## Architecture

```
Browser (React)
    │  HTTP/WS  (port 8001)
    ▼
Express Backend ──── PostgreSQL (sessions, users, meetings, transcripts)
    │
    ├── /auth          Google OAuth 2.0
    ├── /api           REST (meetings, calendar, bots)
    └── /panel (WS)    live transcript events → React dashboard
         ▲
         │  audio chunks + speaker events
    MeetBot (Playwright/Chrome)
         │
         └── audioInjector.js  intercepts WebRTC tracks
              │
              ▼
         Whisper WebSocket (port 3002)  →  transcript segments
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, React Router v6 |
| Backend | Node.js, TypeScript, Express 4 |
| Database | PostgreSQL (pg driver, connect-pg-simple sessions) |
| Browser bot | Playwright + Chromium |
| Transcription | OpenAI Whisper (self-hosted via WebSocket) |
| AI summaries | Groq API — `llama-3.1-8b-instant` |
| Auth | Google OAuth 2.0, express-session |
| Real-time | WebSocket (ws library) |

---

## Prerequisites

- **Node.js** 18+
- **PostgreSQL** 14+
- **Google Chrome** installed (Playwright uses the system Chrome channel)
- **Groq API key** — free at [console.groq.com](https://console.groq.com)
- **Google Cloud project** with OAuth 2.0 credentials and Calendar API enabled
- *(Optional)* Self-hosted Whisper WebSocket server on port 3002

---

## Installation

```bash
# Clone the repo
git clone <repo-url>
cd noteAI

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

---

## Configuration

Copy `.env.example` to `.env` inside the `backend/` directory and fill in every value:

```bash
cd backend
cp .env.example .env
```

### Environment Variables

| Variable | Description | Example |
|---|---|---|
| `PORT` | Port the Express server listens on | `8001` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://localhost/noteai` |
| `SESSION_SECRET` | Random secret for signing session cookies | `change-me-in-production` |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 client ID from Google Cloud Console | `760653...apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 client secret | `GOCSPX-...` |
| `GOOGLE_REDIRECT_URI` | Must match an authorised URI in Google Cloud Console | `http://localhost:8001/accounts/google/login/callback/` |
| `GROQ_API_KEY` | Groq API key for AI summaries | `gsk_...` |
| `WHISPER_URL` | WebSocket URL of the Whisper transcription server | `ws://localhost:3002` |
| `BOT_GOOGLE_EMAIL` | *(Optional)* Google account the bot signs in as | `bot@example.com` |
| `BOT_GOOGLE_PASSWORD` | *(Optional)* Password for the bot account | |
| `BOT_CHROME_PROFILE_DIR` | *(Optional)* Pre-authenticated Chrome profile path | `/tmp/noteai-bot-profile` |

---

## Running the App

> **Always use port 8001.** The Google OAuth redirect URI points to port 8001, so accessing the app via the Vite dev server (5173) breaks the auth flow.

### Production-style (recommended)

```bash
# 1. Build the frontend
cd frontend && npm run build

# 2. Build and start the backend (serves the built frontend)
cd ../backend
npm run build
node dist/index.js
```

Open **http://localhost:8001**

### Active frontend development (auto-rebuild on save)

```bash
# Terminal 1 — backend
cd backend && node dist/index.js

# Terminal 2 — frontend watch mode (rebuilds on every save)
cd frontend && npm run build -- --watch
```

Refresh **http://localhost:8001** after each rebuild.

---

## Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services** → **Credentials**
2. Create an **OAuth 2.0 Client ID** (Web application)
3. Under **Authorised redirect URIs** add:
   ```
   http://localhost:8001/accounts/google/login/callback/
   ```
4. Enable the **Google Calendar API** in **APIs & Services → Library**
5. Copy the client ID and secret into `backend/.env`

> If you see **"Sign-in failed: invalid state"**, the redirect URI in your `.env` (`GOOGLE_REDIRECT_URI`) does not match the URI registered in Google Cloud Console. They must be identical.

---

## Database Setup

```bash
# Create the database
createdb noteai

# Apply the schema (safe to re-run — all statements are idempotent)
psql noteai < backend/src/db/schema.sql
```

The schema creates these tables:

| Table | Purpose |
|---|---|
| `users` | Google OAuth profiles + tokens |
| `session` | Express session store (connect-pg-simple) |
| `meetings` | Meeting records with AI summary fields |
| `calendar_events` | Synced Google Calendar events |
| `transcript_segments` | Per-speaker transcript lines |
| `speakers` | Speaker label ↔ name mapping |
| `dom_speaker_events` | Raw speaker start/end events from the DOM |

---

## How It Works

### 1. Bot joins the meeting

When you click **Send Bot** or **+ Start Recording**:

1. The backend extracts the meeting code from the Google Meet URL (e.g. `abc-defg-hij`)
2. Playwright launches a headless Chrome instance and navigates to the Meet URL
3. `audioInjector.js` is injected as an init script — it patches the browser's WebRTC layer to intercept per-participant audio tracks
4. The bot sets its display name, mutes its mic/camera, and clicks "Join now"
5. A WebSocket session is created on the backend to hold the meeting state

### 2. Live transcription

For each participant audio track:

- Raw PCM samples are forwarded over WebSocket to the Whisper server
- Whisper returns transcript segments (interim + final)
- A `SpeakerCorrelator` matches Whisper segments to DOM speaker events (start/end times from the Google Meet UI) to identify who said what
- Final segments are saved to PostgreSQL and broadcast to all connected panel clients (the React dashboard)

### 3. Meeting ends

When the bot leaves or is stopped:

1. All Whisper clients are disconnected
2. `ended_at` and `duration_ms` are written to the `meetings` row
3. A `meeting.ended` event is broadcast to the dashboard
4. AI summary generation runs in the background (non-blocking)

### 4. AI summary generation

The full transcript is sent to Groq (Llama 3.1 8B) with a structured prompt. The response is parsed into four sections and saved to the `meetings` row (`summary`, `key_insights`, and `metadata` columns).

---

## AI Summary Breakdown

Each completed meeting shows four expandable sections on the detail page:

| Section | Description |
|---|---|
| **Detailed Meeting Rewrite** | 8–15 sentence narrative rewrite of the full meeting in polished prose — who said what, what was debated, how conclusions were reached |
| **Executive Summary** | Concise 3–5 sentence overview of the meeting outcome and most important decisions |
| **Key Insights & Action Items** | Bullet list of concrete action items and decisions, including who is responsible |
| **Important Points** | Numbered list of key facts, dates, deadlines, figures, and names mentioned |

All sections are independently collapsible. The top three default to open; Important Points defaults to collapsed.

> The AI prompt understands **Hinglish** (Hindi + English mixed speech) and always responds in English.

---

## API Reference

All endpoints except `GET /api/health` require an authenticated session (Google sign-in).

### Auth

| Method | Path | Description |
|---|---|---|
| `GET` | `/auth/google` | Initiate Google OAuth flow |
| `GET` | `/auth/google/callback` | OAuth callback (internal) |
| `GET` | `/auth/me` | Return current user or `401` |
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
| `GET` | `/api/bots/active` | List currently active bot meeting codes |

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
| `/audio?meetingId=<code>` | Client → Server | Raw PCM audio from browser extension |

---

## Project Structure

```
noteAI/
├── backend/
│   ├── src/
│   │   ├── bot/
│   │   │   ├── meetBot.ts          # Playwright bot (joins Meet, captures audio)
│   │   │   ├── botManager.ts       # Manages active bot instances
│   │   │   └── audioInjector.js    # Injected into Chrome — WebRTC intercept
│   │   ├── db/
│   │   │   ├── client.ts           # PostgreSQL pool
│   │   │   └── schema.sql          # Idempotent schema (run to initialise DB)
│   │   ├── routes/
│   │   │   ├── auth.ts             # Google OAuth + session endpoints
│   │   │   ├── api.ts              # Meeting + bot REST endpoints
│   │   │   └── calendar.ts         # Calendar sync + auto-join endpoints
│   │   ├── services/
│   │   │   ├── googleAuth.ts       # OAuth client, token exchange, user upsert
│   │   │   ├── calendarService.ts  # Google Calendar API calls
│   │   │   ├── meetingService.ts   # DB queries for meetings + transcripts
│   │   │   ├── schedulerService.ts # Auto-join cron (checks every 60s)
│   │   │   ├── speakerCorrelator.ts# Matches Whisper segments → speaker names
│   │   │   └── summaryService.ts   # Groq AI summary generation
│   │   ├── types/
│   │   │   └── session.d.ts        # express-session type augmentation
│   │   ├── ws/
│   │   │   ├── ingestHandler.ts    # WebSocket session management
│   │   │   └── whisperClient.ts    # WebSocket client for Whisper server
│   │   ├── config.ts               # Reads .env into typed config object
│   │   └── index.ts                # Express app entry point
│   ├── .env                        # Local secrets (never commit)
│   ├── .env.example                # Template for .env
│   └── package.json
│
└── frontend/
    ├── src/
    │   ├── components/
    │   │   ├── MainLayout.tsx       # Sidebar + <Outlet> shell
    │   │   ├── ProtectedRoute.tsx   # Auth guard (redirects to /signin)
    │   │   ├── Sidebar.tsx          # Navigation + user card
    │   │   ├── Topbar.tsx           # Page header bar
    │   │   ├── Pill.tsx             # Status badge
    │   │   ├── Toggle.tsx           # On/off switch
    │   │   └── LiveMeetingCard.tsx  # Real-time meeting card
    │   ├── context/
    │   │   └── AuthContext.tsx      # useAuth() — user state + sign-out
    │   ├── hooks/
    │   │   └── useLiveMeetings.tsx  # WebSocket live meeting state
    │   ├── lib/
    │   │   ├── api.ts               # fetch wrappers for all backend endpoints
    │   │   ├── types.ts             # Shared TypeScript interfaces
    │   │   ├── format.ts            # Date / duration / time formatters
    │   │   └── colors.ts            # Speaker colour palette
    │   ├── pages/
    │   │   ├── SignIn.tsx           # Public sign-in page
    │   │   ├── Dashboard.tsx        # Home — stats, upcoming, recent
    │   │   ├── LiveRecording.tsx    # Active bot sessions
    │   │   ├── MeetingDetail.tsx    # Transcript + expandable AI summary
    │   │   ├── AllMeetings.tsx      # Searchable meeting history
    │   │   ├── Calendar.tsx         # Calendar events + auto-join
    │   │   └── Profile.tsx          # User settings
    │   ├── App.tsx                  # Route tree (ProtectedRoute wraps all pages)
    │   └── main.tsx                 # React root, AuthProvider, BrowserRouter
    └── package.json
```

---

## Development Workflow

### Rebuilding after changes

```bash
# Backend change
cd backend && npm run build && node dist/index.js

# Frontend change only
cd frontend && npm run build
# then refresh http://localhost:8001
```

### Whisper server

The transcription server must be running separately on `ws://localhost:3002`. If it is not running, the bot will still join meetings and the UI will still work, but no transcript will be generated.

### Bot Chrome profile (optional)

To have the bot join meetings as a signed-in Google account (needed for organisation-restricted calls):

```bash
# 1. Launch Chrome with a dedicated profile
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --user-data-dir=/tmp/noteai-bot-profile

# 2. Sign in to Google in that window, then close it

# 3. Add to .env
BOT_CHROME_PROFILE_DIR=/tmp/noteai-bot-profile
```

---

## Troubleshooting

### "Sign-in failed: invalid state"

The hostname you used to access the app (`localhost`) and the `GOOGLE_REDIRECT_URI` in `.env` must match. Set:

```
GOOGLE_REDIRECT_URI=http://localhost:8001/accounts/google/login/callback/
```

And register exactly that URI in Google Cloud Console → Credentials → Authorised redirect URIs.

### Dashboard shows no data after sign-in

1. Check that the backend is running on port 8001: `curl http://localhost:8001/api/health`
2. Open DevTools → Network and look for a failed `/auth/me` request. A `401` means the session cookie was not set — this usually means the redirect URI hostname mismatch described above.

### Bot fails to join meeting

- Make sure Google Chrome is installed (Playwright uses the system `chrome` channel)
- For org-restricted meetings, set up `BOT_CHROME_PROFILE_DIR` with a pre-authenticated profile
- Check backend logs for `[bot]` lines to see what step failed

### No AI summary generated

- Confirm `GROQ_API_KEY` is set in `.env`
- Check backend logs for `[summary]` lines after the meeting ends
- The transcript must have at least 100 characters for summary generation to run

### Calendar sync returns no events

- Ensure the **Google Calendar API** is enabled in your Google Cloud project
- Re-authenticate (sign out and sign back in) to get a fresh token with Calendar scope
- Only events with a Google Meet link and a future start time are synced
