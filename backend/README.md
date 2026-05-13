# NoteAI — Backend

Express + TypeScript service that runs the meeting bot, ingests per-speaker audio, brokers transcription via Deepgram, persists everything to PostgreSQL, runs a tiered AI analysis pipeline (Groq), schedules auto-launched meetings, and broadcasts live events over WebSocket.

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
8. [Deepgram Transcription](#deepgram-transcription)
9. [AI Pipeline](#ai-pipeline)
10. [Speaker Identification](#speaker-identification)
11. [Screen-share Detection](#screen-share-detection)
12. [Scheduling](#scheduling)
13. [API Reference](#api-reference)
14. [Project Structure](#project-structure)
15. [Troubleshooting](#troubleshooting)

---

## Architecture

```
                     ┌──────────────────────────────────────────────────┐
                     │  Express (port 8001)                             │
                     │                                                  │
React frontend ───▶  │  /auth         Google OAuth                      │
(5173 in dev,        │  /api          REST: meetings, scheduling, etc.  │  ──▶ PostgreSQL
8001 in prod)        │  /panel        WS: live transcript / events      │
                     │                                                  │
                     │  Scheduler (every 30s) ─┬─▶ calendar_events       │
                     │                          └─▶ scheduled_meetings   │
                     │                              ▼                    │
                     │  MeetBot (Playwright/Chrome)                      │
                     │   └─ audioInjector.js                             │
                     │      ├─ per-track PCM   ──▶ Deepgram nova-2       │
                     │      ├─ DOM speaker observer (SSRC + co-occur)    │
                     │      └─ screen-share detection (track + DOM)      │
                     │                                                   │
                     │  AI Pipeline (runs on meeting end)                │
                     │   ├─ detectLanguage                                │
                     │   ├─ runSummaryModule    (chunk → trim → keyword) │
                     │   ├─ runActionItemsModule                          │
                     │   ├─ runKeyQuestionsModule                         │
                     │   ├─ runChaptersModule                             │
                     │   └─ runSpeakerInsightsModule                      │
                     └───────────────────────────────────────────────────┘
```

---

## Prerequisites

- **Node.js** 18+
- **PostgreSQL** 14+
- **Google Chrome** installed (Playwright uses the system `chrome` channel)
- **Deepgram API key** — sign up at [console.deepgram.com](https://console.deepgram.com)
- **Groq API key** — free at [console.groq.com](https://console.groq.com)
- **Google Cloud project** with OAuth 2.0 credentials and the Calendar API enabled

---

## Installation

```bash
cd backend
npm install
```

Then (one-time) sign the bot into Google so it can join org-restricted meetings:

```bash
npx tsx bot-login.ts
```

This opens a real Chrome window. Sign in to a Google account that has access to the meetings you want to record, then close the window. The profile is saved to `~/.noteai/bot-profile` (Windows: `C:\Users\<you>\.noteai\bot-profile`) and reused on every bot launch.

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
| `DEEPGRAM_API_KEY` | Deepgram API key for real-time transcription | `dg_...` |
| `GROQ_API_KEY` | Groq API key for AI pipeline | `gsk_...` |
| `BOT_GOOGLE_EMAIL` | *(Optional)* Google account the bot signs in as | `bot@example.com` |
| `BOT_GOOGLE_PASSWORD` | *(Optional)* Password for the bot account | |
| `BOT_CHROME_PROFILE_DIR` | *(Optional)* Pre-authenticated Chrome profile path | `~/.noteai/bot-profile` (default) |

Without `DATABASE_URL` the backend will still boot and the live dashboard will work, but nothing will be persisted.

---

## Running the App

### Development (auto-reload)

```bash
npm run dev
```

The backend listens on `http://localhost:8001`. The React frontend should run separately on Vite's dev server — see [../frontend/README.md](../frontend/README.md).

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

When the React app is being served by Vite on port 5173, OAuth still completes through port 8001 (because that's the registered redirect target). After signing in you'll land back on the backend; navigate to `http://localhost:5173` and the session cookie is shared on `localhost`.

---

## Database Setup

Cross-platform migration (works identically on macOS, Linux, Windows):

```bash
npm run db:migrate
```

This runs [`scripts/migrate.js`](scripts/migrate.js) — a small Node script that reads `DATABASE_URL` from `.env` and applies [`src/db/schema.sql`](src/db/schema.sql) using the `pg` client. The schema is idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) — safe to re-run after every pull.

| Table | Purpose |
|---|---|
| `users` | Google OAuth profiles + access/refresh tokens |
| `session` | Express session store (managed by `connect-pg-simple`) |
| `meetings` | Meeting records + `summary`, `key_insights`, `metadata` (action items, chapters, speakers, screenshare events), `processing_status`, `language` |
| `scheduled_meetings` | User-created scheduled meetings — title, meet_url, scheduled_for, auto_launch, status |
| `calendar_events` | Synced Google Calendar events |
| `transcript_segments` | Per-speaker transcript lines |
| `speakers` | Speaker label ↔ name mapping per meeting |
| `dom_speaker_events` | Raw speaker start/end events captured from the Meet DOM |

---

## Deepgram Transcription

Real-time audio transcription via Deepgram's `nova-2` model. Each WebRTC audio track gets its own Deepgram WebSocket — one stream per participant, so we never have to disentangle mixed audio.

The client lives at [`src/ws/deepgramClient.ts`](src/ws/deepgramClient.ts) (imported with the legacy alias `WhisperClient` for backwards compatibility in [`ingestHandler.ts`](src/ws/ingestHandler.ts)).

If `DEEPGRAM_API_KEY` is missing the bot still joins meetings and the dashboard still renders, but no transcripts appear.

---

## AI Pipeline

After a meeting ends, [`aiPipelineService.runPipeline()`](src/services/aiPipelineService.ts) runs six independent modules **sequentially** (Groq free tier is 6000 TPM; parallel calls burst past it). Each module is isolated — failures in one don't block the others.

```
detectLanguage()
  ↓
runSummaryModule()          ── summary + detailed rewrite + key insights + important points
  ↓
runActionItemsModule()      ── {task, owner, dueHint}[]
  ↓
runKeyQuestionsModule()     ── unresolved questions
  ↓
runChaptersModule()         ── timestamped topic chapters
  ↓
runSpeakerInsightsModule()  ── per-person contributions, ownership, collaboration
```

### Per-module fallback chain

```
Module (e.g. summary)
  │
  ├─ Primary path           chunked single-shot, structured JSON, retry x4 with
  │                         exponential backoff + Groq retry-hint parser
  │                         ("try again in 950ms" honored verbatim)
  │
  ├─ Fallback 1             trimmed single-shot (12K char slice)
  │
  └─ Fallback 2             keyword extraction — pure JS, no LLM
                            (top-frequency phrases, first 3 sentences)
```

Each module records its outcome in `meetings.processing_status`:
- `ok` — primary succeeded
- `partial` — fallback used or chunked merge incomplete
- `failed` — all retries exhausted
- `skipped` — no API key or insufficient transcript

### Multilingual handling

[`detectLanguage()`](src/services/aiPipelineService.ts) classifies the transcript as `en` / `hi` / `hi-en` / etc. via a cheap small-token call. The detected code is passed to every subsequent prompt as a hint. Outputs are always English (so search and downstream consumers stay consistent), but the prompts faithfully paraphrase Hinglish or Hindi without losing meaning.

### Dynamic sizing

No hardcoded bullet or sentence counts. Every prompt says:

> "Scale each list to what the transcript supports."
> "Return as many chapters as the content needs — minimum 2, no upper limit."

For long transcripts the summary module chunks at 6K chars with 400-char overlap, then merges. Short transcripts go single-shot.

---

## Speaker Identification

The bot needs to bind each WebRTC audio track to the right participant name. [`audioInjector.js`](src/bot/audioInjector.js) implements a three-signal approach inside the browser:

1. **SSRC fast-path** — at every `checkSpeakers` tick, try `pc.getReceivers().getSynchronizationSources()` to find the SSRC, then look it up on a tile via `[data-ssrc]`. When this works, it's authoritative.
2. **DOM "currently speaking" observer** — `tileIsSpeakingNow()` checks each `[data-participant-id]` tile for multiple signals (CSS class containing "speak", aria-label hints, animated audio-meter SVG/canvas).
3. **Co-occurrence cache** — when an audio track is loud AND exactly one DOM tile is "speaking" at the same moment, increment a counter for that `{trackId, tileName}` pair. After **3 consecutive confirmations**, the binding is locked at `high` confidence and never overwritten.

The previous index-based fallback (which caused name swaps when tiles reordered) has been removed. If no confident binding exists yet, the bot **emits nothing** rather than guess — the result is correct names slightly delayed (usually within the speaker's first few seconds of speech) instead of fast wrong names.

Track-name bindings are reported to the backend via `window.noteAISendTrackInfo(trackId, name)`.

---

## Screen-share Detection

Two independent signals, OR-combined, debounced at the state level so transient flips don't spam events:

1. **WebRTC track signal** — `RTCPeerConnection.ontrack` for video tracks. Treated as screen-share if `contentHint` is "detail"/"text", or label mentions screen/window/tab/desktop/presentation, or it's a large (≥1280px) low-fps (≤15fps) feed.
2. **DOM presenter scan** — `detectDomPresenter()` looks for aria-labels containing "presenting"/"is sharing", innerText `"X is presenting"` patterns, or a tile that's notably larger than other tiles (>3× the area of the second-largest).

Events emitted:

| Event | When | Persisted? |
|---|---|---|
| `screenshare_start` | First moment either signal fires | Appended to `meetings.metadata.screenshareEvents` |
| `screenshare_end` | Both signals quiet | Appended |
| `screenshare_update` | State unchanged but presenter name newly identified | Appended |

All three are broadcast to any panel WebSocket clients listening for that meeting, so a future "Currently sharing" indicator in the UI can subscribe.

---

## Scheduling

Two scheduling paths share the same in-process scheduler ([`schedulerService.ts`](src/services/schedulerService.ts)), polling every 30s:

### 1. User-created scheduled meetings (`scheduled_meetings` table)
- Created via `POST /api/meetings/schedule` from the **+ Schedule Meeting** modal
- Fields: `title`, `meeting_url`, `scheduled_for`, `description?`, `auto_launch`, `status`, `meeting_id`
- Auto-launches inside `[now - 30s, now + 60s]` window when `auto_launch=true` and `status='scheduled'`
- Status transitions: `scheduled` → `launched` (after bot starts) or `cancelled` (user removes)
- Manual override: `POST /api/meetings/scheduled/:id/start` launches immediately

### 2. Google Calendar events (`calendar_events` table)
- Pulled via `POST /api/calendar/sync`
- Auto-joined N minutes before start (per-user `users.auto_join_minutes` setting)
- Toggled per-event via `PATCH /api/calendar/events/:id/auto-join`

Both paths converge on `botManager.launch(meetingUrl, userId)`, which returns the meeting **code** (e.g. `abc-defg-hij`). The DB UUID is resolved separately via [`getMeetingIdByCode`](src/services/meetingService.ts) and stored as the `meeting_id` FK on the scheduled / calendar row.

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
| `POST` | `/api/meetings/:code/stop` | Gracefully stop bot + run AI pipeline |
| `POST` | `/api/meetings/:code/exit` | Force-kill bot, no AI pipeline |
| `GET` | `/api/meetings/:id/transcript` | Transcript segments for a meeting |
| `GET` | `/api/meetings/:id/summary` | Full pipeline output (summary, action items, chapters, speakers, language, processing_status) |
| `GET` | `/api/bots/active` | List active bot meeting codes |

### Scheduled Meetings

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/meetings/schedule` | Create a scheduled meeting `{title, meetingUrl, scheduledFor, description?, autoLaunch?}` |
| `GET` | `/api/meetings/scheduled` | List non-cancelled scheduled meetings for the user |
| `POST` | `/api/meetings/scheduled/:id/start` | Manual early launch |
| `DELETE` | `/api/meetings/scheduled/:id` | Cancel (sets `status='cancelled'`) |

### Calendar

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/calendar/sync` | Pull events from Google Calendar into DB |
| `GET` | `/api/calendar/events` | List upcoming calendar events |
| `PATCH` | `/api/calendar/events/:id/auto-join` | Toggle auto-join for an event |

### WebSocket

| Path | Direction | Description |
|---|---|---|
| `/panel?meetingId=<code>` | Server → Client | Live transcript events, bot status, screen-share events |
| `/audio?meetingId=<code>` | Client → Server | Raw PCM audio (legacy browser-extension path) |

---

## Project Structure

```
backend/
├── scripts/
│   └── migrate.js              Cross-platform schema runner (used by db:migrate)
├── src/
│   ├── bot/
│   │   ├── meetBot.ts          Playwright bot — joins Meet, controls Chrome
│   │   ├── botManager.ts       Active bot registry, launch/stop/exit
│   │   └── audioInjector.js    Injected into Chrome — WebRTC intercept,
│   │                           SSRC + co-occurrence speaker mapping,
│   │                           screen-share detection
│   ├── db/
│   │   ├── client.ts           PostgreSQL pool
│   │   └── schema.sql          Idempotent schema (run via npm run db:migrate)
│   ├── routes/
│   │   ├── auth.ts             Google OAuth + session endpoints
│   │   ├── api.ts              Meetings + scheduling + bot REST endpoints
│   │   └── calendar.ts         Calendar sync + auto-join endpoints
│   ├── services/
│   │   ├── googleAuth.ts             OAuth client, token exchange, user upsert
│   │   ├── calendarService.ts        Google Calendar API
│   │   ├── meetingService.ts         DB queries; savePipelineResults,
│   │   │                             appendScreenShareEvent, getMeetingIdByCode
│   │   ├── scheduledMeetingService.ts CRUD for scheduled_meetings + due-window query
│   │   ├── schedulerService.ts       Combined cron — calendar + scheduled, every 30s
│   │   ├── speakerCorrelator.ts      Matches Deepgram segments ↔ speaker names
│   │   ├── aiPipelineService.ts      Tiered AI pipeline (6 modules + fallbacks)
│   │   └── summaryService.ts         Thin compat wrapper around runPipeline
│   ├── types/
│   │   └── session.d.ts        express-session type augmentation
│   ├── ws/
│   │   ├── ingestHandler.ts    WS session management, event routing
│   │   └── deepgramClient.ts   Deepgram nova-2 WebSocket client
│   ├── config.ts               Reads .env into a typed config object
│   └── index.ts                Express entry point
├── bot-login.ts                One-time Google sign-in for the bot profile
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

### Bot fails to join the meeting

- Ensure Google Chrome is installed (Playwright uses the system `chrome` channel)
- For org-restricted meetings, run `npx tsx bot-login.ts` once to seed a signed-in profile
- Inspect backend logs for `[bot]` lines to see which step failed
- "You can't join this video call" → the bot account doesn't have access. Sign into a different Google account via `bot-login.ts`, or ask the host to admit guests.

### Failed to start scheduled meeting

The endpoint logs the real error to the backend terminal (look for `[api] manual start error:`). Most common cause: schema not migrated — re-run `npm run db:migrate`.

### No AI pipeline output / modules all `failed`

- Confirm `GROQ_API_KEY` is set
- Watch for `[ai]` lines in logs after the meeting ends. Retries show as `attempt 1/4 failed (server hint: 950ms). Retrying in 950ms…`
- Pipeline runs **sequentially** with a 1.5s pause between modules to stay under Groq's 6000 TPM free-tier limit. If you're still hitting limits, upgrade to Groq's Dev Tier or reduce `MAX_TRANSCRIPT_CHARS_PER_CALL` in [`aiPipelineService.ts`](src/services/aiPipelineService.ts).

### Wrong speaker names in transcripts

The identification logic (SSRC + co-occurrence) takes 3 confirmations before locking a name. Before that, segments may show "Unknown" or use a `medium`-confidence tentative name. Once locked, names won't swap. If they swap *after* locking, please file an issue with the backend log — the lock was supposed to be permanent.

### Screen-share not detected

Two independent signals are used; one usually fires even when Meet renames DOM classes. Check the backend log for `[NoteAI] screen-share STARTED`. If neither signal fires, Google may have changed both the track contentHint and the aria-label pattern — open `audioInjector.js` and inspect `detectDomPresenter()` / `noteVideoTrack()`.

### Calendar sync returns no events

- Enable the **Google Calendar API** in your Google Cloud project
- Re-authenticate (sign out, sign back in) to refresh the token with the Calendar scope
- Only events that have a Google Meet link and a future start time are synced

### `npm run db:migrate` says `DATABASE_URL not set`

The migration script uses `dotenv` to load `.env`. Confirm `backend/.env` exists and contains `DATABASE_URL=postgres://…`. If you're running the script from a different directory, make sure your cwd is `backend/`.
