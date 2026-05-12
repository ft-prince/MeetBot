# NoteAI

AI-powered meeting recorder for Google Meet. A Playwright-controlled bot joins your meeting, transcribes every speaker in real time, and generates a structured AI analysis when the call ends — all visible in a secure per-user dashboard.

This is the **monorepo overview**. Each app has its own README with full setup and architecture details:

- [`backend/`](backend/README.md) — Express API, Playwright bot, WebSocket ingest, AI summary
- [`frontend/`](frontend/README.md) — React 18 + Vite dashboard

---

## Repo Layout

```
noteAI/
├── README.md          ← you are here (overview + quick start)
├── backend/           Express + Playwright + Whisper ingest
│   └── README.md      backend-specific setup, API, DB schema
└── frontend/          React + Vite dashboard
    └── README.md      frontend-specific dev workflow + WS architecture
```

---

## High-Level Architecture

```
Browser (React, Vite dev @ 5173 or built bundle served by backend)
    │  HTTP/WS
    ▼
Express Backend (port 8001) ──── PostgreSQL (sessions, users, meetings, transcripts)
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

The **panel WebSocket connects directly from the browser to the backend on port 8001**, even when the React app is served by Vite dev on 5173. Vite's WS proxy was unreliable for the `/panel` upgrade, so the frontend always opens the WS against the real backend host. See [frontend/README.md](frontend/README.md) for routing details.

---

## Quick Start

Prereqs: Node.js 18+, PostgreSQL 14+, Google Chrome (Playwright uses the system Chrome channel), a Groq API key, and a Google Cloud project with OAuth credentials + Calendar API enabled.

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

# 4. Start everything (three terminals)
# Terminal A — Whisper sidecar (required for transcription)
python whisper_service.py

# Terminal B — backend on 8001
npm run dev

# Terminal C — Vite dev server on 5173
cd ../frontend && npm run dev
```

Open **http://localhost:5173**, sign in with Google (the OAuth callback runs through port 8001), paste a Google Meet URL, and click **Start Recording**.

For production-style single-port deployment (`npm run build` in `frontend/` then run the backend), see [backend/README.md](backend/README.md#running-the-app).

---

## Features

- **Google Sign-In** — OAuth 2.0; every user only sees their own data
- **Live Bot Recording** — Playwright-controlled Chrome joins Google Meet as "NoteAI Recorder"
- **Real-time Transcription** — per-speaker audio routed through self-hosted Whisper
- **Speaker Identification** — DOM scraping correlates participant names with audio tracks
- **AI Analysis** — Groq (Llama 3.1) produces four sections after the call:
  - Detailed narrative rewrite
  - Executive summary
  - Key insights & action items
  - Important points / facts
- **Calendar Integration** — sync Google Calendar; auto-join meetings N minutes before start
- **Secure Dashboard** — protected routes; unauthenticated users are redirected to sign-in

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, React Router v6 |
| Backend | Node.js 18+, TypeScript, Express 4 |
| Database | PostgreSQL (`pg`, `connect-pg-simple` sessions) |
| Browser bot | Playwright + Chromium |
| Transcription | OpenAI Whisper (self-hosted via WebSocket on port 3002) |
| AI summaries | Groq API — `llama-3.1-8b-instant` |
| Auth | Google OAuth 2.0, `express-session` |
| Real-time | WebSocket (`ws`) |

---

## Where to Go Next

| You want to… | Read |
|---|---|
| Run the backend, configure env vars, look at the API or DB schema | [backend/README.md](backend/README.md) |
| Develop the React UI with HMR on port 5173, or understand the WS routing | [frontend/README.md](frontend/README.md) |
| Troubleshoot "bot joined but no transcript appears" | [frontend/README.md](frontend/README.md#troubleshooting) |
| Set up Google OAuth credentials | [backend/README.md](backend/README.md#google-oauth-setup) |
