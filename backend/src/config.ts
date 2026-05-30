import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '8001', 10),
  databaseUrl: process.env.DATABASE_URL || '',
  whisperUrl: process.env.WHISPER_URL || 'ws://localhost:3002',
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
  // Which engine joins Zoom meetings: 'inhouse' (Playwright ZoomBot) or 'recall' (Recall AI fallback)
  zoomBotMode: (process.env.ZOOM_BOT_MODE === 'recall' ? 'recall' : 'inhouse') as 'inhouse' | 'recall',
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