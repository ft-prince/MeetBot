/**
 * Integration test for BOT_ENGINE=docker
 *
 * Usage:
 *   BOT_ENGINE=docker \
 *   BOT_DOCKER_BACKEND_WS=ws://localhost:8001 \
 *   npx tsx scripts/test-docker-bot.ts https://meet.google.com/abc-defg-hij
 *
 * What it tests:
 *   1. botManager.launch() spawns `docker run noteai-bot`
 *   2. Container starts, services come up (logged to stdout)
 *   3. Bot connects to the mock WS on :19999 and sends bot_joining
 *   4. botManager.stop() signals SIGTERM to the container
 */

import { WebSocketServer, WebSocket } from 'ws';
import { spawn } from 'child_process';

async function main() {

// ── Override env before importing config-dependent modules ────────────────────
process.env.BOT_ENGINE = 'docker';
process.env.BOT_DOCKER_IMAGE = process.env.BOT_DOCKER_IMAGE || 'noteai-bot';
process.env.BOT_DOCKER_NETWORK = 'host';

const MOCK_PORT = 19998;
const MEETING_URL = process.argv[2] || 'https://meet.google.com/test-abc-test';
const TIMEOUT_MS = 60_000;

// ── Step 1: Start mock WS server ──────────────────────────────────────────────
console.log('\n[test] Step 1 — starting mock WS server on :', MOCK_PORT);

const receivedEvents: string[] = [];
let gotBotJoining = false;

const wss = new WebSocketServer({ port: MOCK_PORT });
wss.on('connection', (ws, req) => {
  console.log('[mock-ws] bot connected  url=' + req.url);
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      process.stdout.write(`[mock-ws] audio  bytes=${(data as Buffer).length}\n`);
    } else {
      const msg = data.toString();
      console.log('[mock-ws] json  ' + msg);
      try {
        const parsed = JSON.parse(msg);
        receivedEvents.push(parsed.type);
        if (parsed.type === 'bot_joining') gotBotJoining = true;
      } catch {}
    }
  });
  ws.on('close', () => console.log('[mock-ws] bot disconnected'));
});

await new Promise<void>(resolve => wss.on('listening', resolve));
console.log('[test] mock WS ready on ws://localhost:' + MOCK_PORT);

// ── Step 2: Launch the docker bot directly ────────────────────────────────────
console.log('\n[test] Step 2 — spawning docker run noteai-bot …');

// On macOS Docker Desktop, --network=host doesn't bridge to host localhost.
// Use host.docker.internal to reach the host from inside the container.
const isMac = process.platform === 'darwin';
const hostAddr = isMac ? 'host.docker.internal' : 'localhost';
const backendWs = `ws://${hostAddr}:${MOCK_PORT}/audio?meetingId=test-abc-test`;
const proc = spawn('docker', [
  'run', '--rm',
  '--network', 'host',
  '-e', `MEETING_URL=${MEETING_URL}`,
  '-e', `BACKEND_WS=${backendWs}`,
  '-e', 'BOT_JOIN_TIMEOUT=30',
  'noteai-bot',
], { stdio: ['ignore', 'pipe', 'pipe'] });

proc.stdout?.on('data', (d: Buffer) => process.stdout.write('[container] ' + d));
proc.stderr?.on('data', (d: Buffer) => process.stderr.write('[container] ' + d));

// ── Step 3: Wait for bot_joining event (or timeout) ───────────────────────────
console.log('\n[test] Step 3 — waiting for bot_joining event (timeout ' + TIMEOUT_MS / 1000 + 's) …');

const result = await Promise.race<'ok' | 'timeout'>([
  new Promise<'ok'>(resolve => {
    const check = setInterval(() => {
      if (gotBotJoining) { clearInterval(check); resolve('ok'); }
    }, 200);
  }),
  new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), TIMEOUT_MS)),
]);

// ── Step 4: Stop container ─────────────────────────────────────────────────────
console.log('\n[test] Step 4 — sending SIGTERM to container …');
proc.kill('SIGTERM');
await new Promise<void>(resolve => proc.on('close', resolve));
wss.close();

// ── Results ───────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════');
if (result === 'ok') {
  console.log('✅  PASS — bot_joining received');
  console.log('   Events:', receivedEvents.join(' → '));
} else {
  console.log('❌  FAIL — timeout waiting for bot_joining');
  console.log('   Events received:', receivedEvents.length ? receivedEvents.join(' → ') : '(none)');
  process.exitCode = 1;
}
console.log('══════════════════════════════════════════════\n');
process.exit(process.exitCode ?? 0);
}

main().catch(err => { console.error('[test] fatal:', err); process.exit(1); });
