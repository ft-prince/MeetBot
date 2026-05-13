# NoteAI

AI-powered meeting recorder for Google Meet. A Playwright-controlled bot joins your meeting, transcribes every speaker in real time, detects when someone shares their screen, and runs a multi-stage AI pipeline (summary, action items, key questions, chapters, speaker insights) once the call ends — all visible in a secure per-user dashboard with scheduling, search, filtering, and CSV/JSON export.

This is the **monorepo overview**. Each app has its own README with full setup and architecture details:

- [`backend/`](backend/README.md) — Express API, Playwright bot, WebSocket ingest, AI pipeline, scheduler
- [`frontend/`](frontend/README.md) — React 18 + Vite dashboard with tabbed meeting view

---

## Repo Layout

```
noteAI/
├── README.md          ← you are here (overview + quick start)
├── backend/           Express + Playwright + Deepgram ingest + AI pipeline
│   └── README.md      backend setup, API, DB schema, pipeline architecture
└── frontend/          React + Vite dashboard
    └── README.md      frontend dev workflow + WS architecture + components
```

---

## High-Level Architecture

```
Browser (React, Vite dev @ 5173 or built bundle served by backend)
    │  HTTP/WS
    ▼
Express Backend (port 8001) ──── PostgreSQL
    │
    ├── /auth                    Google OAuth 2.0
    ├── /api                     REST (meetings, scheduling, calendar, bots)
    └── /panel (WS)              live transcript events → React dashboard
         ▲
         │  audio chunks + speaker events + screen-share events
    MeetBot (Playwright/Chrome)
         │
         └── audioInjector.js    intercepts WebRTC tracks, watches DOM
              │
              ▼
         Deepgram WebSocket  →  transcript segments + diarization

         │ on meeting end
         ▼
    AI Pipeline (Groq)            language → summary → action items
                                  → questions → chapters → speaker insights
                                  (sequential, retry-with-backoff, per-module fallbacks)

    Scheduler (every 30s)         auto-launches scheduled meetings + calendar events
```

The **panel WebSocket connects directly from the browser to the backend on port 8001**, even when the React app is served by Vite dev on 5173. Vite's WS proxy was unreliable for the `/panel` upgrade. See [frontend/README.md](frontend/README.md#networking--routing) for details.

---

## Features

### Live recording
- **Google Sign-In** — OAuth 2.0; every user only sees their own data
- **Live Bot Recording** — Playwright-controlled Chrome joins Google Meet as "NoteAI Recorder"
- **Real-time Transcription** — per-speaker audio routed through Deepgram (`nova-2`)
- **Robust Speaker Identification** — SSRC matching + DOM "currently speaking" observer + 3-confirmation co-occurrence cache. No more swapped names from index-based fallbacks.
- **Screen-share Detection** — WebRTC track inspection + DOM presenter scanning; events persisted to `meetings.metadata.screenshareEvents[]`

### Scheduling
- **Create Meeting** — schedule a meeting with title / Meet link / date / time / description
- **Auto-launch** — the bot launches itself 0–60s before the scheduled time
- **Manual Start** — bypass the timer with "Start" from the dashboard
- **Cancel** — remove scheduled meetings before they fire
- **Google Calendar Sync** — auto-join calendar events N minutes before start (per-user setting)

### AI Pipeline (multi-module, fault-tolerant)
After every meeting, six independent modules run sequentially. Each has retry-with-backoff (Groq rate-limit aware) and graceful fallback:

| Module | Output | Fallbacks |
|---|---|---|
| Language detection | `en`, `hi`, `hi-en`, etc. | `null` if model unavailable |
| Summary + Insights | executive summary, detailed rewrite, key insights, important points | chunked → trimmed single-shot → keyword extraction |
| Action Items | `{task, owner, dueHint}[]` — owners and due dates extracted | empty array, `failed` status |
| Open Questions | unresolved questions raised in the meeting | empty array, `failed` status |
| Chapters | timestamped topic chapters with start/end ms | empty array, `failed` status |
| Speaker Insights | per-person contributions, ownership, collaboration | empty array, `failed` status |

Every module's outcome is recorded in `meetings.processing_status` JSONB (`ok` / `partial` / `failed` / `skipped`). The UI surfaces this — failed modules show a clear status badge instead of a confusing empty section.

### Dashboard
- **Stats grid** — total meetings, live, summaries, hours recorded, upcoming scheduled, completed, average length, engagement rate
- **Upcoming Meetings** — merges Google Calendar events with user-scheduled meetings, sorted by time
- **Recent Meetings** — last 10 completed meetings with status pills
- **Quick Join** — paste a Meet link, click Start Recording
- **Schedule Meeting** — modal with date/time + auto-launch toggle

### All Meetings
- Full-text search across titles and meeting codes
- Date range filter (7d / 30d / 90d / all)
- Status filter (summarized / processing)
- Sort (newest / oldest / longest / shortest)
- **CSV / JSON export** of the filtered list

### Meeting Detail (tabbed)
- **Transcript** — full diarized transcript, scrollable, speaker-colored
- **Summary** — executive summary + detailed rewrite
- **Action Items** — numbered list with owners and due-hint badges
- **Insights** — key insights, important points, open questions
- **Speakers** — speaking-time bars + per-person contributions / ownership / collaboration
- **Chapters** — clickable timeline with timestamps and topic summaries
- **Analytics** — participants, words, WPM, speaking distribution chart

Every tab has Loading / Error / Empty / "module failed" states. Language pill in the header.

---

## Quick Start (macOS / Linux)

Prereqs: Node.js 18+, PostgreSQL 14+, Google Chrome, a Deepgram API key, a Groq API key, and a Google Cloud project with OAuth credentials + Calendar API enabled.

```bash
# 1. Install
cd backend && npm install
cd ../frontend && npm install

# 2. Configure backend env
cd ../backend
cp .env.example .env
# Edit .env — see backend/README.md for the full list

# 3. Sign the bot into Google (one-time, opens a real Chrome window)
npx tsx bot-login.ts

# 4. Apply DB schema (cross-platform, reads .env automatically)
npm run db:migrate

# 5. Start everything (two terminals)
npm run dev                       # Terminal A — backend on 8001
cd ../frontend && npm run dev     # Terminal B — Vite on 5173
```

Open **http://localhost:5173**, sign in with Google, paste a Google Meet URL, and click **Start Recording** — or click **+ Schedule Meeting** to schedule one for later.

For production-style single-port deployment (build the frontend, run only the backend), see [backend/README.md](backend/README.md#running-the-app).

---

## Quick Start (Windows)

Identical to macOS / Linux — the migration script and all tooling are now cross-platform.

```bat
:: 1. Install
cd backend & npm install
cd ..\frontend & npm install

:: 2. Configure backend env
cd ..\backend
copy .env.example .env
:: Edit .env in your editor

:: 3. Sign the bot into Google (one-time)
npx tsx bot-login.ts

:: 4. Apply DB schema
npm run db:migrate

:: 5. Start (two terminals)
npm run dev
cd ..\frontend & npm run dev
```

Chrome profile lives at `C:\Users\<you>\.noteai\bot-profile`. Override with `BOT_CHROME_PROFILE_DIR=D:\path\to\profile` in `.env` if needed.

**Headless mode:** the bot runs with a visible Chrome window by default. Google Meet sometimes blocks `headless: true` — keep the visible window unless it causes problems for your deployment. To launch the backend silently on Windows, wrap the npm command in a `.vbs` invisible shell or use NSSM / Task Scheduler.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, React Router v6 |
| Backend | Node.js 18+, TypeScript, Express 4 |
| Database | PostgreSQL (`pg`, `connect-pg-simple` sessions) |
| Browser bot | Playwright + system Chrome |
| Transcription | Deepgram `nova-2` (real-time WebSocket) |
| AI pipeline | Groq API — `llama-3.1-8b-instant` with retry/backoff and fallbacks |
| Scheduler | In-process `setInterval` polling `scheduled_meetings` + `calendar_events` every 30s |
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
| Understand the AI pipeline + fallback chain | [backend/README.md](backend/README.md#ai-pipeline) |
| Understand speaker-name binding (SSRC + co-occurrence) | [backend/README.md](backend/README.md#speaker-identification) |
