# NoteAI

AI-powered meeting recorder for **Google Meet, Zoom, and Microsoft Teams**. A bot joins your meeting, transcribes every speaker, and generates a structured AI analysis when the call ends — all visible in a secure per-user dashboard.

This is the **monorepo overview**. Each app has its own README with full setup and architecture details:

- [`backend/`](backend/README.md) — Express API, bot management, transcription, AI summary
- [`frontend/`](frontend/README.md) — React 18 + Vite dashboard

---

## Repo Layout

```
noteAI/
├── README.md          ← you are here (overview + quick start)
├── backend/           Express + Playwright (Meet) + Recall AI (Zoom/Teams)
│   └── README.md      backend-specific setup, API, DB schema
└── frontend/          React + Vite dashboard
    └── README.md      frontend-specific dev workflow + WS architecture
```

---

## High-Level Architecture

NoteAI uses a **hybrid bot strategy** — the best tool for each platform:

```
Browser (React, Vite dev @ 5173 or built bundle served by backend)
    │  HTTP/WS
    ▼
Express Backend (port 8001) ──── PostgreSQL (sessions, users, meetings, transcripts)
    │
    ├── /auth          Google OAuth 2.0
    ├── /api           REST (meetings, calendar, bots)
    ├── /api/recall    Recall AI webhook + management routes
    └── /panel (WS)    live transcript events → React dashboard
         ▲
         │
    ┌────┴─────────────────────────────────────────┐
    │                                              │
 Google Meet URL                          Zoom / Teams URL
    │                                              │
    ▼                                              ▼
MeetBot (self-hosted, Playwright/Chrome)   RecallBot (cloud)
    │                                              │
    ├── audioInjector.js                    Recall cloud bot joins
    │   intercepts per-participant WebRTC          │
    │   tracks → SSRC name resolution              │
    │                                              ▼
    ▼                                       Recall transcribes
Deepgram (per-track streaming)              with chosen provider
    │                                       (meeting_captions / Deepgram)
    ▼                                              │
SpeakerCorrelator                                  ▼
    │                                       After meeting ends:
    ▼                                       backend polls Recall →
Transcript segments  ────────►  DB  ◄────  downloads final JSON →
                                                   saves segments
                                                   │
                                                   ▼
                                            AI pipeline (Groq Llama 3.1)
                                            → summary, action items,
                                              key insights
```

### Why two bots?

| Platform | Bot | Why |
|---|---|---|
| **Google Meet** | Self-hosted Playwright (`MeetBot`) | Uses standard WebRTC — we intercept `RTCPeerConnection` to get per-participant audio tracks with rock-solid name attribution |
| **Zoom / Teams** | Recall AI cloud (`RecallBot`) | Zoom uses a proprietary WASM audio engine, Teams uses custom signaling. Recall's managed cloud bot handles audio capture + speaker attribution natively. No local Chromium needed |

---

## Quick Start

**Prereqs:** Node.js 18+, PostgreSQL 14+, Google Chrome (for Meet bot), a Groq API key, a Deepgram API key, a Recall AI API key, and a Google Cloud project with OAuth credentials + Calendar API enabled.

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

# Transcription (used by Meet bot directly + Recall via Deepgram provider)
DEEPGRAM_API_KEY=...
DEEPGRAM_LANGUAGE=hi          # or 'en', 'es', 'fr', etc.

# AI pipeline (summary / action items)
GROQ_API_KEY=...

# Recall AI (cloud bot for Zoom + Teams)
RECALL_API_KEY=...
RECALL_API_BASE=https://ap-northeast-1.recall.ai/api/v1   # change region if needed
```

See [backend/README.md](backend/README.md) for optional vars (auto-join scheduler, Calendar webhooks, etc.).

---

## Features

- **Google Sign-In** — OAuth 2.0; every user only sees their own data
- **Multi-platform bots** — Google Meet, Zoom, Microsoft Teams
- **Real-time transcription** for Meet (per-speaker streams via Deepgram)
- **Post-meeting transcription** for Zoom / Teams (via Recall AI cloud)
- **Speaker identification** — real participant names, not "Speaker 1 / 2"
- **Multilingual** — Hindi / English / 30+ Deepgram languages
- **AI Analysis (Groq Llama 3.1)** — runs after every meeting:
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
| Meet bot | Playwright + Chromium + `audioInjector.js` |
| Zoom / Teams bot | Recall AI (managed cloud) |
| Transcription | Deepgram (`nova-2` streaming) + Recall providers (meeting_captions / Deepgram) |
| AI summaries | Groq API — `llama-3.1-8b-instant` |
| Auth | Google OAuth 2.0, `express-session` |
| Real-time | WebSocket (`ws`) |

---

## Supported Languages

Set `DEEPGRAM_LANGUAGE` in `backend/.env`:

| Value | Behaviour |
|---|---|
| `en` | Zoom/Teams native captions (built-in speaker names); Deepgram English for Meet |
| `hi` | Deepgram nova-2, Hindi |
| `es`, `fr`, `de`, `zh`, `ja`, … | Deepgram nova-2 with that language code |

After changing, restart the backend.

---

## Where to Go Next

| You want to… | Read |
|---|---|
| Run the backend, configure env vars, look at the API or DB schema | [backend/README.md](backend/README.md) |
| Develop the React UI with HMR on port 5173, or understand the WS routing | [frontend/README.md](frontend/README.md) |
| Troubleshoot "bot joined but no transcript appears" | [frontend/README.md](frontend/README.md#troubleshooting) |
| Set up Google OAuth credentials | [backend/README.md](backend/README.md#google-oauth-setup) |
| Understand the Recall AI integration | [backend/README.md](backend/README.md#recall-ai-integration) |
