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
};
