# NoteAI — Frontend

React 18 + TypeScript + Vite dashboard for NoteAI. It handles Google sign-in, lets users dispatch the meeting bot, renders the live transcript stream, and shows the AI-generated summary once the meeting ends.

For the monorepo overview see [../README.md](../README.md). For the Express service this app talks to, see [../backend/README.md](../backend/README.md).

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [Running the App](#running-the-app)
4. [Environment Variables](#environment-variables)
5. [Networking & Routing](#networking--routing)
6. [Project Structure](#project-structure)
7. [Live Transcript Pipeline](#live-transcript-pipeline)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

- **Node.js** 18+
- A running backend on `http://localhost:8001` — see [../backend/README.md](../backend/README.md)
- An authenticated Google session (sign-in goes through the backend on 8001)

---

## Installation

```bash
cd frontend
npm install
```

---

## Running the App

There are two supported workflows: a Vite dev server on **5173** (HMR, recommended for active frontend work) or a static build served by the backend on **8001**.

### Vite dev server (port 5173, HMR)

```bash
# Terminal A — backend on 8001
cd ../backend && npm run dev

# Terminal B — Vite dev server on 5173
npm run dev
```

Open **http://localhost:5173**.

Google OAuth still completes on port 8001 because that is the registered redirect URI. Sign in once at `http://localhost:8001`, then return to `http://localhost:5173` — the session cookie is shared on `localhost`.

### Production-style (single port 8001)

```bash
npm run build           # produces frontend/dist
cd ../backend
npm run build
node dist/index.js
```

The backend serves `frontend/dist` from `/` whenever it exists. Open **http://localhost:8001**.

### Watch mode without Vite dev server

If you want the backend to serve the bundle but still rebuild on save:

```bash
npm run build -- --watch
```

Refresh `http://localhost:8001` after each rebuild.

### Preview a production build locally

```bash
npm run build
npm run preview
```

---

## Environment Variables

Create `frontend/.env.local` (gitignored) when you need to override defaults. All variables must start with `VITE_` to be exposed to the browser.

| Variable | Description | Default |
|---|---|---|
| `VITE_BACKEND_WS` | Base URL for the live-transcript WebSocket. Overrides the dev-mode default. | unset → `ws://<hostname>:8001` in Vite dev on port 5173, otherwise same-origin |

Example for a backend running on a different host:

```
VITE_BACKEND_WS=ws://my-backend.local:8001
```

Restart the Vite dev server after changing `.env.local`.

---

## Networking & Routing

In Vite dev (port 5173) the frontend talks to the backend through three different channels:

| Request | Goes to | How |
|---|---|---|
| `/api/*`, `/auth/*` (HTTP) | `http://localhost:8001` | Vite proxy (`server.proxy` in [`vite.config.ts`](vite.config.ts)) |
| `/panel?meetingId=…` (WebSocket) | `ws://localhost:8001` | **Direct connection** from the browser, computed by `buildPanelWsBase` in [`src/hooks/useLiveMeetings.tsx`](src/hooks/useLiveMeetings.tsx) |
| Google OAuth redirect | `http://localhost:8001/accounts/google/login/callback/` | Browser-level redirect, not a fetch |

### Why the WebSocket is direct, not proxied

Vite's WebSocket proxy worked unreliably for the `/panel` upgrade — `/api` HTTP would proxy fine, but the WS upgrade silently failed. The visible symptom was: bot joined, audio reached Whisper, backend produced transcript segments, but the React panel never received any events and stayed on "Waiting for speech…".

To fix this once and for all, the frontend now connects directly to the backend host for the WS:

```ts
// frontend/src/hooks/useLiveMeetings.tsx
function buildPanelWsBase(): string {
  // 1. Explicit override
  if (import.meta.env.VITE_BACKEND_WS) return import.meta.env.VITE_BACKEND_WS

  // 2. Vite dev on 5173 → talk straight to backend on 8001
  if (import.meta.env.DEV && location.port === '5173') {
    return `${proto}://${location.hostname}:8001`
  }

  // 3. Production (backend serves the bundle) → same origin
  return `${proto}://${location.host}`
}
```

In production all three channels share the page origin, so the same code path also works there.

---

## Project Structure

```
frontend/
├── src/
│   ├── components/
│   │   ├── MainLayout.tsx       Sidebar + <Outlet> shell
│   │   ├── ProtectedRoute.tsx   Auth guard — redirects to /signin
│   │   ├── Sidebar.tsx          Navigation + user card
│   │   ├── Topbar.tsx           Page header
│   │   ├── Pill.tsx             Status badge
│   │   ├── Toggle.tsx           On/off switch
│   │   └── LiveMeetingCard.tsx  Live meeting card (transcript + summary)
│   ├── context/
│   │   └── AuthContext.tsx      useAuth() — user state + sign-out
│   ├── hooks/
│   │   └── useLiveMeetings.tsx  WS-driven live meeting store + provider
│   ├── lib/
│   │   ├── api.ts               fetch wrappers for all backend endpoints
│   │   ├── types.ts             Shared TypeScript interfaces
│   │   ├── format.ts            Date / duration / clock formatters
│   │   └── colors.ts            Speaker colour palette
│   ├── pages/
│   │   ├── SignIn.tsx           Public sign-in page
│   │   ├── Dashboard.tsx        Stats, upcoming, recent
│   │   ├── LiveRecording.tsx    Active bot sessions
│   │   ├── MeetingDetail.tsx    Transcript + expandable AI summary
│   │   ├── AllMeetings.tsx      Searchable meeting history
│   │   ├── Calendar.tsx         Calendar events + auto-join
│   │   └── Profile.tsx          User settings
│   ├── App.tsx                  Route tree (ProtectedRoute wraps all pages)
│   ├── main.tsx                 React root, AuthProvider, BrowserRouter
│   └── index.css                Tailwind entry
├── index.html                   Vite entry HTML
├── vite.config.ts               Vite + proxy config
├── tailwind.config.js
├── tsconfig.json
└── package.json
```

---

## Live Transcript Pipeline

```
LiveRecording.tsx
   └─ POST /api/meetings/join             (via Vite proxy → backend)
        └─ backend creates ingest session
            └─ returns { meetingId }

   └─ useLiveMeetings().start(meetingId)
        └─ opens WebSocket to buildPanelWsBase() + /panel?meetingId=...
             └─ direct connection to ws://localhost:8001 in dev

   └─ ws.onmessage  → switch on msg.type:
        bot.joined           → status = 'live'
        transcript.interim   → update interim caption
        transcript.final     → append segment to list
        speaker.identified   → backfill speaker names on existing segments
        meeting.ended        → status = 'ended', start polling /summary
        bot.error            → status = 'error'

   └─ <LiveMeetingCard /> renders segments, interim caption, summary
```

`useLiveMeetings` is a React context provider mounted in `App.tsx`. Any page can read or mutate live meeting state via `useLiveMeetings()`.

### Capture engine is transparent to the frontend

The `/panel` WebSocket contract above is **identical regardless of which backend capture engine is active** (`BOT_ENGINE` in `backend/.env`):

- **`inhouse`** (default) — Playwright bots + a local Whisper sidecar, with Deepgram-style diarization labels resolved to real names via the backend correlator. This path emits `speaker.identified` to backfill names on already-rendered segments.
- **`vexa`** — a self-hosted [Vexa](https://github.com/Vexa-ai/vexa) bot (no browser automation) that returns real speaker names inline on each segment. Finals already carry `speakerName`, so `speaker.identified` is simply never sent on this path — not a missing feature.

Either way the frontend handles the same `bot.joined` / `transcript.*` / `meeting.ended` / `bot.error` events, so **no frontend changes are needed to switch engines**.

---

## Troubleshooting

### Bot joins but no transcript appears

Symptom: backend log shows `[botManager] Bot joined …` and `[session] New whisper client for track …`, but the live card stays on "Waiting for speech…".

Cause: the panel WebSocket isn't reaching the backend.

Checks:

1. DevTools → Network → **WS** tab. The connection URL must be `ws://localhost:8001/panel?meetingId=…`, **not** `ws://localhost:5173/...`. If you see the 5173 URL, hard-reload to clear a stale Vite bundle.
2. Backend log should print `[ingest] New connection: /panel, meeting=<code>` right after the bot joins. If it doesn't, the browser can't reach 8001 — check that nothing else is bound to that port and your firewall allows it.
3. If your backend is on a different host or port, set `VITE_BACKEND_WS` in `.env.local` and restart Vite.

### `/api` requests return 401 after sign-in

The session cookie is set on the backend origin (port 8001). When using Vite dev on 5173, Vite's HTTP proxy forwards `/api` and `/auth` to 8001 and carries the cookie. If you see persistent 401s:

- Confirm the backend is up: `curl http://localhost:8001/api/health`
- Clear cookies for `localhost` and sign in again
- Make sure `GOOGLE_REDIRECT_URI` in the backend `.env` exactly matches the URI registered in Google Cloud Console (trailing slash included)

### Live card shows interim captions but no finalised segments

Whisper only emits final segments after a chunk is fully transcribed. Brief utterances may appear only as interim text. If finals never arrive, check the backend log for `[whisper-client]` errors — the Whisper sidecar on `ws://localhost:3002` is probably down or returning empty results.

### Styles look broken after a rebuild

Tailwind generates a fresh `index.css` on each build. If you see unstyled HTML:

- Stop and restart `npm run dev` (Tailwind sometimes misses new class names introduced by hot edits to non-source files)
- Confirm `tailwind.config.js` `content` globs cover `src/**/*.{ts,tsx}`
