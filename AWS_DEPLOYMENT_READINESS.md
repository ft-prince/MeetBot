# noteAI — AWS Deployment Readiness Audit & Plan

**Target:** single EC2 instance running Docker Compose, serving backend + frontend on `meet.nexren.ai`.
**STT:** Deepgram (cloud) — already the active engine.
**Date:** 2026-10-01 · Branch: `zoom-gmeet-inhouse`

> Scope of this document: audit only. No AWS changes made. It records current state, what works, the gaps to close before deploying, and a step-by-step plan.


> **Superseded for the actual deploy steps by [deploy/README.md](deploy/README.md)** (Docker Compose + Cloudflare Tunnel, tested on arm64). Kept for background.

---

## 1. Verified baseline (local)

| Check | Result |
|---|---|
| `npm test` (backend) | ✅ 47/47 pass |
| `npm run build` (tsc) | ✅ clean |
| `STT_ENGINE` | ✅ `deepgram` |
| Deepgram client | ✅ nova-2, smart_format, diarization, interim results, reconnect + half-open watchdog, keepalive |
| `BOT_ENGINE` | `inhouse` (Playwright bots run in-process inside the backend container) |

---

## 2. Architecture as it will run on EC2

```
                 meet.nexren.ai (443, TLS)
                          │
                   [reverse proxy]      ← GAP: not present yet (nginx/Caddy)
                          │  HTTP + WS upgrade (/audio, /ws)
                          ▼
   ┌─────────────────────────────────────────────┐
   │ noteai-backend container (backend/Dockerfile) │
   │  • Express API + WebSocket server  :8001      │
   │  • Serves React SPA from frontend/dist        │
   │  • Xvfb :99 (docker-entrypoint.sh)            │
   │  • In-house Playwright bots (Meet/Zoom/Teams) │
   │      audio captured IN-PAGE (Web Audio) →     │
   │      no PulseAudio / audio device needed      │
   │  • Chrome profile ← bot-profile volume        │
   └─────────────────────────────────────────────┘
        │                         │
        ▼                         ▼
   Postgres (RDS or              Deepgram cloud (STT)
   host) via DATABASE_URL        Groq (summaries), Google OAuth
```

**Key fact — the meeting bot works headless on EC2.** All three injectors
(`audioInjector.js`, `zoomAudioInjector.js`, `teamsAudioInjector.js`) capture
meeting audio *inside the Chrome page* via the Web Audio API (hooking the
meeting's own `AudioContext` / `AudioWorklet` / `ScriptProcessor`), then post PCM
back to the backend. Chrome launches with `--mute-audio`. **No real sound card
or PulseAudio is required.** The backend Dockerfile provides the only runtime
dependency the bot needs: a virtual X display (`Xvfb`). This is why the deploy is
viable on a plain EC2 instance.

> The separate `bot-service/Dockerfile` (with PulseAudio/noVNC) is only used by
> the optional `BOT_ENGINE=docker` per-meeting-container path. Not needed for the
> chosen `inhouse` deployment — ignore it for this plan.

---

## 3. The Chrome login session — how it carries to AWS

This was your main concern. Here is exactly how it works today and what to do on EC2.

- The signed-in Chrome profile lives in a **Docker named volume `bot-profile`**,
  mounted at `/data/bot-profile` (= `BOT_CHROME_PROFILE_DIR`). It is **not** baked
  into the image, so it survives rebuilds and redeploys.
- You create the login **once, on the server**, over VNC:
  1. `ENABLE_VNC=1 docker compose run --service-ports backend npx tsx bot-login.ts`
     (this is what `backend/bot-login-docker.sh` does).
  2. Connect a VNC client to the instance on **:5900** (password `noteai`, override
     with `VNC_PASSWORD`), sign in to Google in the Chrome window, close it.
  3. The profile is saved into the `bot-profile` volume and reused by every meeting.

**Two ways to get your local session onto AWS:**
- **(Recommended) Re-login on the server over VNC.** Cleanest; avoids Google
  flagging a copied profile. Do the VNC login step once after first deploy.
- **(Faster but fragile) Copy the local profile** into the volume with
  `docker cp` / `docker run -v`. Google often invalidates a profile moved to a new
  machine/IP, so budget for a re-login anyway.

### ⚠️ Gaps in the current login setup

1. **Only the Google/Meet profile is wired up.** `docker-compose.yml` mounts one
   volume and only `BOT_CHROME_PROFILE_DIR` is set. The **Zoom**
   (`BOT_ZOOM_CHROME_PROFILE_DIR`) and **Teams** (`BOT_TEAMS_CHROME_PROFILE_DIR`)
   profile dirs are **not** mounted or set → Zoom/Teams will fall back to
   guest/credential join, not a persistent signed-in profile. If you need
   authenticated Zoom/Teams bots, add volumes + env for those (see §6).
2. **Google login from a datacenter (AWS) IP is the top operational risk.**
   Google frequently challenges logins from new ASNs/geographies. Expect to pass
   a verification on first VNC login, and keep VNC access for occasional re-auth.
   Mitigations: log in via VNC *from the instance* (so the IP matches), use a
   dedicated bot Google account, keep the instance IP stable (Elastic IP).

---

## 4. Deployment gaps to close (before `docker compose up`)

| # | Gap | Why it matters | Fix |
|---|-----|----------------|-----|
| 1 | **No reverse proxy / TLS** | `meet.nexren.ai` needs HTTPS and must forward WebSocket upgrades (`/audio`, session WS). | Add nginx or Caddy container (Caddy = auto Let's Encrypt). Must set `proxy_set_header Upgrade/Connection` for WS. |
| 2 | **`docker-compose.yml` is backend-only & dev-shaped** | Env defaults point at `host.docker.internal`, `SESSION_SECRET: change-me`, no Deepgram/STT/APP_BASE_URL/OAuth-for-domain. | Add a production compose (or override) with real env, the proxy, and RDS URL. |
| 3 | **Migrations** — mostly handled | ✅ `ensureSchema()` runs on startup and auto-applies the idempotent `src/db/schema.sql` if core tables (or the `users.plan` sentinel column) are missing; `src/db/schema.sql` ships in the image and resolves via `process.cwd()`. So a fresh RDS self-provisions on first boot. | No action required for first deploy. Keep `npm run db:migrate` as a manual fallback. Note: new columns are picked up only when the sentinel changes, so for incremental schema changes run `db:migrate` explicitly. |
| 4 | **Frontend build not produced in image** | Backend serves `frontend/dist`; the backend Dockerfile copies `frontend-vanilla` (legacy) but not a built React `frontend/dist`. | Build the React app and ship `frontend/dist`, or accept the legacy vanilla UI. Decide which UI ships. |
| 5 | **Google OAuth redirect URI** | `GOOGLE_REDIRECT_URI` defaults to `127.0.0.1:8001`; user login breaks on the domain. | Set `GOOGLE_REDIRECT_URI=https://meet.nexren.ai/accounts/google/login/callback/` and add it in Google Cloud console. Also set `APP_BASE_URL=https://meet.nexren.ai`. |
| 6 | **Secrets** | Deepgram/Groq/Google/SMTP keys must be present and not committed. | Put in an `.env` on the instance (root-owned) or AWS SSM Parameter Store; reference from compose. |
| 7 | **Session cookie hardening** (not a blocker) | Session cookie is `httpOnly` + `sameSite: 'lax'` with `secure` **unset** (false), and there is **no** `app.set('trust proxy', 1)`. Logins will still work over HTTPS (a non-secure cookie is sent on https too), but the cookie isn't hardened. | Optional: set `cookie.secure: true` (prod) + `app.set('trust proxy', 1)` so the cookie is TLS-only. Fine to defer. |
| 8 | **Zoom/Teams profiles** (see §3) | Authenticated Zoom/Teams joins won't persist. | Add volumes + env if needed. |

---

## 5. EC2 sizing & networking

- **Instance:** Chrome + Xvfb per concurrent meeting is memory-hungry. Start at
  **t3.large (2 vCPU / 8 GB)** for a few concurrent bots; **t3.xlarge (16 GB)**
  if you expect several simultaneous meetings. CPU STT is *not* a factor
  (Deepgram is cloud).
- **Storage:** 30–40 GB gp3 (Chrome profiles + Docker layers + Playwright image
  is ~2 GB).
- **Elastic IP:** yes — keeps the Google-trusted IP stable across restarts.
- **Security group inbound:** 443 (public), 22 (your IP), **5900 VNC (your IP
  only, temporary — for bot login)**. Do **not** expose 5900 publicly.
- **Outbound:** 443 to Deepgram, Groq, Google, Zoom/Teams/Meet.
- **Platform:** build/run on **linux/amd64** (the EC2 default) — no Apple-Silicon
  emulation issues that plague local macOS runs.

---

## 6. Step-by-step deploy plan (when you say go)

1. **Provision**: EC2 (Ubuntu 22.04, t3.large, 40 GB gp3, Elastic IP), security
   group as §5. Install Docker + Compose plugin.
2. **DNS**: point `meet.nexren.ai` A record → Elastic IP.
3. **DB**: create RDS Postgres (or run Postgres in compose); capture `DATABASE_URL`.
4. **Code**: clone repo, checkout branch, create `/opt/noteai/.env` with all §4 secrets.
5. **Frontend**: `cd frontend && npm ci && npm run build` → produces `frontend/dist`
   (or decide to ship legacy vanilla UI and skip).
6. **Add production compose** with: backend service, **Caddy/nginx** proxy
   (TLS + WS forwarding), Zoom/Teams profile volumes if needed, real env.
7. **Migrate**: none needed on first boot — `ensureSchema()` auto-applies the
   schema against a fresh RDS. (Fallback: `docker compose run --rm backend npm run db:migrate`.)
8. **Bot login (VNC)**: open 5900 to your IP, run `bot-login-docker.sh`, sign in
   to Google (and Zoom/Teams if configured), close. Then close port 5900.
9. **Start**: `docker compose up -d`.
10. **Smoke test**: load `https://meet.nexren.ai`, log in (Google OAuth), schedule
    a test Google Meet, confirm the bot joins, captures audio, and a Deepgram
    transcript appears live.

---

## 7. Residual risks / verify-in-prod

- **Google bot-detection on AWS IP** — the #1 thing that can break joins; have VNC
  ready for re-auth. (This is the same reason an earlier session explored Vexa.)
- **Zoom/Teams web-client changes** — selectors drift; test each platform end-to-end.
- **WS through the proxy** — confirm `/audio` upgrade works behind TLS (a common
  misconfiguration that silently drops transcription).
- **Concurrency** — load-test the number of simultaneous bots the instance can hold
  before OOM; scale instance or cap concurrent meetings.

---

## Bottom line

The STT (Deepgram) and the in-house meeting bot are **architecturally ready for a
single-EC2 + Docker-Compose deploy** — the bot needs only Xvfb (no audio device),
which the backend image already provides, and the Chrome login persists in a Docker
volume you create once over VNC. The work remaining is **deployment plumbing**, not
application changes: a TLS reverse proxy with WS forwarding, a production compose
with real env/secrets, building the frontend, fixing the OAuth
redirect/base URL for the domain, and (if you need authenticated Zoom/Teams)
wiring their profile volumes. None of these are blockers — they're the §6 checklist.
