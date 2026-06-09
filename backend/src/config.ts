import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '8001', 10),
  databaseUrl: process.env.DATABASE_URL || '',
  whisperUrl: process.env.WHISPER_URL || 'ws://localhost:3002',
  // Speech-to-text engine:
  //   'deepgram' — Deepgram nova-2 streaming (default, cloud)
  //   'whisper'  — local WhisperX sidecar (whisper_service.py, :3002)
  //   'aikosh'   — local AIKosh/AI4Bharat IndicConformer sidecar (aikosh_service.py, :3003)
  sttEngine: (['whisper', 'aikosh'].includes(process.env.STT_ENGINE || '')
    ? process.env.STT_ENGINE
    : 'deepgram') as 'deepgram' | 'whisper' | 'aikosh',
  aikoshSttUrl: process.env.AIKOSH_STT_URL || 'ws://localhost:3003',
  sessionSecret: process.env.SESSION_SECRET || 'noteai-dev-secret',
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://127.0.0.1:8001/accounts/google/login/callback/',
  },
  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
  },
  // Optional: path to a Chrome user-data-dir with a Google account already signed in.
  botChromeProfileDir: process.env.BOT_CHROME_PROFILE_DIR || '',
  // Bot Google account — auto sign-in before joining each meeting
  botGoogleEmail:    process.env.BOT_GOOGLE_EMAIL    || '',
  botGooglePassword: process.env.BOT_GOOGLE_PASSWORD || '',
  // Zoom bot — run `npx tsx scripts/zoom-login.ts` once to create the profile
  botZoomChromeProfileDir: process.env.BOT_ZOOM_CHROME_PROFILE_DIR || '',
  botZoomEmail:    process.env.BOT_ZOOM_EMAIL    || '',
  botZoomPassword: process.env.BOT_ZOOM_PASSWORD || '',
  // Teams bot — run `npx tsx scripts/teams-login.ts` once to create the profile.
  // Empty profile → guest join (works for meetings that allow anonymous join).
  botTeamsChromeProfileDir: process.env.BOT_TEAMS_CHROME_PROFILE_DIR || '',
  botTeamsEmail:    process.env.BOT_TEAMS_EMAIL    || '',
  botTeamsPassword: process.env.BOT_TEAMS_PASSWORD || '',
  // Which engine joins Teams meetings: 'inhouse' (Playwright TeamsBot) or 'recall'
  teamsBotMode: (process.env.TEAMS_BOT_MODE === 'recall' ? 'recall' : 'inhouse') as 'inhouse' | 'recall',
  // Which engine joins Zoom meetings: 'inhouse' (Playwright ZoomBot) or 'recall' (Recall AI fallback)
  zoomBotMode: (process.env.ZOOM_BOT_MODE === 'recall' ? 'recall' : 'inhouse') as 'inhouse' | 'recall',
  // Master capture engine.
  //   'inhouse'  — in-process Playwright bots (default)
  //   'vexa'     — self-hosted Vexa bot API, no browser automation
  //   'docker'   — spin up a noteai-bot Docker container per meeting
  botEngine: (['vexa', 'docker'].includes(process.env.BOT_ENGINE || '')
    ? process.env.BOT_ENGINE
    : 'inhouse') as 'inhouse' | 'vexa' | 'docker',
  docker: {
    // Image used by the docker engine (must be pre-built: docker build -t noteai-bot .)
    image: process.env.BOT_DOCKER_IMAGE || 'noteai-bot',
    // Network mode for the container — 'host' works on Linux; on macOS use a
    // host-gateway alias or explicit IP so the bot can reach the backend.
    networkMode: process.env.BOT_DOCKER_NETWORK || 'host',
    // Extra docker run flags (space-separated), e.g. "--cpus=1 --memory=1g"
    extraFlags: process.env.BOT_DOCKER_EXTRA_FLAGS || '',
    // Backend WebSocket base URL reachable from inside the container.
    // On Linux with --network=host this is ws://localhost:8001.
    // On macOS use ws://host.docker.internal:8001
    backendWsBase: process.env.BOT_DOCKER_BACKEND_WS || 'ws://localhost:8001',
  },
  vexa: {
    // Self-hosted Vexa API gateway (default `make all` port). Hosted: https://api.cloud.vexa.ai
    apiUrl: process.env.VEXA_API_URL || 'http://localhost:8056',
    apiKey: process.env.VEXA_API_KEY || '',
    botName: process.env.VEXA_BOT_NAME || 'NoteAI',
    // Empty = Vexa auto-detects language. Otherwise an ISO code e.g. 'en', 'es', 'hi'.
    language: process.env.VEXA_LANGUAGE || '',
  },
  // Support ticket email — set SUPPORT_EMAIL to enable email delivery
  supportEmail: process.env.SUPPORT_EMAIL || '',
  smtp: {
    host:  process.env.SMTP_HOST  || '',
    port:  parseInt(process.env.SMTP_PORT  || '587', 10),
    user:  process.env.SMTP_USER  || '',
    pass:  process.env.SMTP_PASS  || '',
    from:  process.env.SMTP_FROM  || process.env.SMTP_USER || 'noreply@noteai.local',
  },
  recall: {
    // API key from https://app.recall.ai/dashboard/api-keys (NOT the webhook secret)
    apiKey: process.env.RECALL_API_KEY || '',
    // Webhook signing secret (whsec_...) — for verifying incoming webhook payloads
    webhookSecret: process.env.RECALL_WEBHOOK_SECRET || '',
    apiBase: process.env.RECALL_BASE_URL || 'https://ap-northeast-1.recall.ai/api/v1',
    baseUrl: process.env.RECALL_BASE_URL || 'https://ap-northeast-1.recall.ai/api/v1',
  },
};