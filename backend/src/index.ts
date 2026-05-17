import express from 'express';
import http from 'http';
import path from 'path';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { config } from './config';
import { db, dbReady } from './db/client';
import { handleConnection } from './ws/ingestHandler';
import apiRouter from './routes/api';
import authRouter, { handleGoogleCallback } from './routes/auth';
import calendarRouter from './routes/calendar';
import { startScheduler } from './services/schedulerService';
// session type augmentation — loaded via tsconfig includes

const PgSession = connectPgSimple(session);

async function main() {
  try {
    await dbReady();
    console.log('[startup] Database connected');
  } catch (err) {
    console.warn('[startup] Database not available:', (err as Error).message);
    console.warn('[startup] Continuing without DB — transcripts will not be persisted');
  }

  const app = express();
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());

  // ── Sessions ─────────────────────────────────────────────────────
  app.use(
    session({
      store: new PgSession({
        pool: db,
        tableName: 'session',
        createTableIfMissing: true,
      }),
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        httpOnly: true,
        sameSite: 'lax',
      },
    })
  );

  // ── Routes ────────────────────────────────────────────────────────
  app.use('/auth', authRouter);
  // GOOGLE_REDIRECT_URI points to /accounts/google/login/callback/ — register
  // that path explicitly so the OAuth code exchange works rather than falling
  // through to the SPA catch-all.
  app.get('/accounts/google/login/callback', handleGoogleCallback);
  app.get('/accounts/google/login/callback/', handleGoogleCallback);
  app.use('/api', apiRouter);
  app.use('/api/calendar', calendarRouter);

  // Serve the React UI build (frontend/dist). Falls back to the legacy vanilla
  // frontend if the React build hasn't been produced yet.
  const reactBuild = path.resolve(__dirname, '../../frontend/dist');
  const legacyBuild = path.resolve(__dirname, '../frontend-vanilla');
  const fs = await import('fs');
  const frontendDir = fs.existsSync(path.join(reactBuild, 'index.html')) ? reactBuild : legacyBuild;
  console.log(`[startup] Serving frontend from ${frontendDir}`);
  app.use(express.static(frontendDir));
  app.get('*', (_req, res) => res.sendFile(path.join(frontendDir, 'index.html')));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    handleConnection(ws, req).catch(err => {
      console.error('[wss] Unhandled connection error:', err);
      ws.close(1011, 'Internal error');
    });
  });

  server.listen(config.port, () => {
    console.log(`[startup] NoteAI backend running on port ${config.port}`);
    console.log(`[startup]   Web UI       : http://localhost:${config.port}`);
    console.log(`[startup]   REST API     : http://localhost:${config.port}/api`);
    console.log(`[startup]   Google Auth  : http://localhost:${config.port}/auth/google`);
    console.log(`[startup]   Panel stream : ws://localhost:${config.port}/panel?meetingId=<id>`);
  });

  // Start auto-join scheduler (checks every 60s for upcoming calendar meetings)
  startScheduler();
}

main().catch(err => {
  console.error('[startup] Fatal error:', err);
  process.exit(1);
});