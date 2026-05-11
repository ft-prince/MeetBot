import express from 'express';
import http from 'http';
import path from 'path';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { config } from './config';
import { dbReady } from './db/client';
import { handleConnection } from './ws/ingestHandler';
import apiRouter from './routes/api';

async function main() {
  // Verify DB connection
  try {
    await dbReady();
    console.log('[startup] Database connected');
  } catch (err) {
    console.warn('[startup] Database not available:', (err as Error).message);
    console.warn('[startup] Continuing without DB — transcripts will not be persisted');
  }

  const app = express();
  app.use(cors({ origin: '*' }));
  app.use(express.json());
  app.use('/api', apiRouter);

  // Serve the web UI
  const frontendDir = path.resolve(__dirname, '/Users/ftprince/renataIot/noteAI/backend/frontend');
  app.use(express.static(frontendDir));
  app.get('/', (_req, res) => res.sendFile(path.join(frontendDir, 'index.html')));

  const server = http.createServer(app);

  // Single WebSocket server handles both /audio and /panel paths
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    handleConnection(ws, req).catch(err => {
      console.error('[wss] Unhandled connection error:', err);
      ws.close(1011, 'Internal error');
    });
  });

  server.listen(config.port, () => {
    console.log(`[startup] NoteAI backend running on port ${config.port}`);
    console.log(`[startup]   Audio ingest : ws://localhost:${config.port}/audio?meetingId=<id>`);
    console.log(`[startup]   Panel stream : ws://localhost:${config.port}/panel?meetingId=<id>`);
    console.log(`[startup]   REST API     : http://localhost:${config.port}/api`);
    console.log(`[startup]   Web UI       : http://localhost:${config.port}`);
  });
}

main().catch(err => {
  console.error('[startup] Fatal error:', err);
  process.exit(1);
});
