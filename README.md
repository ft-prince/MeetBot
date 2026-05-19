# NoteAI

AI-powered meeting recorder for **Google Meet, Zoom, and Microsoft Teams**. A Recall AI cloud bot joins your meeting, transcribes every speaker, and generates a structured AI analysis when the call ends — all visible in a secure per-user dashboard.

This is the **monorepo overview**. Each app has its own README with full setup and architecture details:

- [`backend/`](backend/README.md) — Express API, Recall AI integration, transcription, AI summary
- [`frontend/`](frontend/README.md) — React 18 + Vite dashboard

---

## Repo Layout

```
noteAI/
├── README.md          ← you are here (overview + quick start)
├── backend/           Express + Recall AI integration + AI pipeline
│   └── README.md      backend-specific setup, API, DB schema
└── frontend/          React + Vite dashboard
    └── README.md      frontend-specific dev workflow + WS architecture
```

---

## High-Level Architecture

**All three platforms now go through Recall AI** — one unified bot path:

```
Browser (React, Vite dev @ 5173 or built bundle served by backend)
    │  HTTP/WS
    ▼
Express Backend (port 8001) ──── PostgreSQL (sessions, users, meetings, transcripts)
    │
    ├── /auth          Google OAuth 2.0
    ├── /api           REST (meetings, calendar, bots)
    ├── /api/recall    Recall AI management routes
    └── /panel (WS)    live meeting events → React dashboard
         │
         ▼
   Meeting URL (Meet / Zoom / Teams)
         │
         ▼
   RecallBot.start() ──► Recall AI Cloud
                             │
                             ▼
                     Recall bot joins the meeting,
                     captures audio, attributes speakers,
                     transcribes (Deepgram nova-2 or native captions)
                             │
                  ── meeting ends ──
                             │
                             ▼
   Backend polls Recall for the final transcript:
     GET /bot/{id}/  →  recordings[].media_shortcuts.transcript
                             │
                             ▼
   Downloads JSON  →  saves segments to DB  →  AI pipeline runs
                                                  │
                                                  ▼
                                  Groq Llama 3.1: summary, action items,
                                  key insights, narrative
                                                  │
                                                  ▼
                                  Visible on the homepage after refresh
```

### Why Recall for everything?

| Reason | Detail |
|---|---|
| **No local Chromium** | No Playwright/Chrome to manage on the host machine |
| **Unified flow** | One bot system covers Meet, Zoom, and Teams — same code path, same DB shape, same AI pipeline output |
| **Speaker attribution out of the box** | Recall handles per-participant audio streams + speaker names natively for all platforms |
| **Battle-tested across platforms** | Zoom's proprietary WASM engine and Teams' custom signaling are handled by Recall, not us |

> The self-hosted Playwright `MeetBot` is still present in the codebase as a fallback but is **not used** in the active routing logic.

---

## Quick Start

**Prereqs:** Node.js 18+, PostgreSQL 14+, a Groq API key, a Deepgram API key, a Recall AI API key, and a Google Cloud project with OAuth credentials + Calendar API enabled.

```bash
# 1. Install
cd backend && npm install
cd ../frontend && npm install

# 2. Configure backend env
cd ../backend
cp .env.example .env
# Edit .env — see backend/README.md for the full env var list

# 3. Initialise the database
createdb noteai
psql noteai < src/db/schema.sql

# 4. Start everything (two terminals)
# Terminal A — backend on 8001
npm run dev

# Terminal B — Vite dev server on 5173
cd ../frontend && npm run dev
```

Open **http://localhost:5173**, sign in with Google, paste a Meet / Zoom / Teams link, and click **Start Recording**.

For production-style single-port deployment (`npm run build` in `frontend/` then run the backend), see [backend/README.md](backend/README.md#running-the-app).

---

## Required Environment Variables

Minimum required in `backend/.env`:

```bash
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/noteai

# Session
SESSION_SECRET=change-me-in-production

# Google OAuth (for sign-in + Calendar)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:8001/accounts/google/login/callback/

# Transcription language (used by Recall's Deepgram provider)
DEEPGRAM_API_KEY=...                # passed through to Recall
DEEPGRAM_LANGUAGE=hi                # or 'en', 'es', 'fr', etc.

# AI pipeline (summary / action items)
GROQ_API_KEY=...

# Recall AI (cloud bot for all meeting platforms)
RECALL_API_KEY=...
RECALL_API_BASE=https://ap-northeast-1.recall.ai/api/v1   # change region if needed
```

See [backend/README.md](backend/README.md) for optional vars (auto-join scheduler, Calendar webhooks, etc.).

---

## Features

- **Google Sign-In** — OAuth 2.0; every user only sees their own data
- **Multi-platform bots** — Google Meet, Zoom, Microsoft Teams — all via Recall AI
- **Speaker identification** — real participant names from each platform's native API, not "Speaker 1 / 2"
- **Multilingual transcription** — Hindi / English / 30+ Deepgram languages
- **Post-meeting transcript** — automatically fetched from Recall after the bot leaves, saved to DB
- **AI Analysis (Groq Llama 3.1)** — runs automatically after every meeting:
  - Detailed narrative rewrite
  - Executive summary
  - Key insights & action items
  - Important points / facts
- **Calendar Integration** — sync Google Calendar; auto-join meetings N minutes before start
- **Secure Dashboard** — protected routes; unauthenticated users redirected to sign-in

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, React Router v6 |
| Backend | Node.js 18+, TypeScript, Express 4 |
| Database | PostgreSQL (`pg`, `connect-pg-simple` sessions) |
| Bot platform | **Recall AI** (managed cloud — Meet + Zoom + Teams) |
| Transcription | Deepgram `nova-2` (via Recall) + native Zoom/Teams captions for English |
| AI summaries | Groq API — `llama-3.1-8b-instant` |
| Auth | Google OAuth 2.0, `express-session` |
| Real-time | WebSocket (`ws`) — panel updates and meeting lifecycle events |

---

## Supported Languages

Set `DEEPGRAM_LANGUAGE` in `backend/.env`:

| Value | Behaviour |
|---|---|
| `en` | Zoom/Teams native captions (built-in speaker names); Deepgram English for Meet |
| `hi` | Deepgram nova-2, Hindi (default if env var unset) |
| `es`, `fr`, `de`, `zh`, `ja`, … | Deepgram nova-2 with that language code |

After changing, restart the backend.

---

## Meeting Lifecycle

1. User pastes a meeting URL (Meet, Zoom, or Teams) and clicks **Start Recording**
2. Backend calls Recall's API → cloud bot is created
3. Recall bot joins the meeting (you may need to admit it from the waiting room)
4. Recall transcribes in the cloud throughout the meeting
5. When the bot leaves (call ended, manual stop, or everyone-left timeout):
   - Backend polls Recall every 5s until the transcript status is `done`
   - Downloads the final transcript JSON (per-participant, per-utterance)
   - Saves each segment to PostgreSQL
   - Runs the Groq AI pipeline (summary, action items, insights)
6. Refresh the homepage → meeting card shows transcript + summary

---

## Where to Go Next

| You want to… | Read |
|---|---|
| Run the backend, configure env vars, look at the API or DB schema | [backend/README.md](backend/README.md) |
| Develop the React UI with HMR on port 5173, or understand the WS routing | [frontend/README.md](frontend/README.md) |
| Troubleshoot "bot joined but no transcript appears" | [frontend/README.md](frontend/README.md#troubleshooting) |
| Set up Google OAuth credentials | [backend/README.md](backend/README.md#google-oauth-setup) |
| Understand the Recall AI integration in detail | [backend/README.md](backend/README.md#recall-ai-integration) |
