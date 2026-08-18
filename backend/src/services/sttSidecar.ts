import { spawn, type ChildProcess } from 'child_process';
import net from 'net';
import path from 'path';
import fs from 'fs';
import { config } from '../config';

/**
 * Auto-start the local STT sidecar (aikosh_service.py / whisper_service.py).
 *
 * Why this exists: when STT_ENGINE is a local sidecar but the Python service
 * isn't running, the bot joins the meeting and captures audio fine, but every
 * per-track STT socket gets ECONNREFUSED and silently retries forever — so the
 * meeting produces ZERO transcripts ("bot joined but no live transcription").
 * Starting the sidecar alongside the backend makes the pipeline work end-to-end
 * with no manual step. If a sidecar is already listening (someone started it by
 * hand, or a previous run), we leave it alone.
 */

let child: ChildProcess | null = null;

interface SidecarSpec {
  script: string;       // python file at the backend root
  port: number;         // ws port it listens on
  label: string;        // log prefix
}

function specForEngine(): SidecarSpec | null {
  if (config.sttEngine === 'aikosh') {
    return { script: 'aikosh_service.py', port: portOf(config.aikoshSttUrl, 3003), label: 'aikosh' };
  }
  if (config.sttEngine === 'whisper') {
    return { script: 'whisper_service.py', port: portOf(config.whisperUrl, 3002), label: 'whisper' };
  }
  return null; // deepgram (cloud) — nothing to start
}

function portOf(wsUrl: string, fallback: number): number {
  try {
    const p = new URL(wsUrl).port;
    return p ? parseInt(p, 10) : fallback;
  } catch {
    return fallback;
  }
}

// True if the port is already taken (a sidecar is running). We use a BIND test
// rather than connecting: connecting to the aikosh WebSocket server without an
// HTTP upgrade makes it log "InvalidMessage: did not receive a valid HTTP
// request" on every probe. Binding never touches the sidecar. We test both
// stacks because Python's websockets binds "localhost" to ::1 (IPv6) here, and
// an IPv4-only check would falsely read the port as free and double-spawn.
function isPortInUse(port: number): Promise<boolean> {
  const tryBind = (host: string): Promise<boolean> => new Promise(resolve => {
    const s = net.createServer();
    s.once('error', (err: NodeJS.ErrnoException) => {
      resolve(err.code === 'EADDRINUSE' || err.code === 'EACCES');
    });
    s.once('listening', () => s.close(() => resolve(false)));
    try { s.listen(port, host); } catch { resolve(false); }
  });
  return (async () => (await tryBind('127.0.0.1')) || (await tryBind('::1')))();
}

// Resolve the Python interpreter: prefer the project venv, fall back to PATH.
function resolvePython(cwd: string): string {
  const candidates = process.platform === 'win32'
    ? [path.join(cwd, '.venv', 'Scripts', 'python.exe')]
    : [path.join(cwd, '.venv', 'bin', 'python')];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

export async function startSttSidecar(): Promise<void> {
  const spec = specForEngine();
  if (!spec) {
    console.log(`[stt-sidecar] STT_ENGINE=${config.sttEngine} (cloud) — no local sidecar to start`);
    return;
  }

  if (!config.sttAutostart) {
    console.log(`[stt-sidecar] STT_AUTOSTART=false — not managing ${spec.label}; ` +
      `start it yourself (e.g. python ${spec.script}) on :${spec.port}`);
    return;
  }

  // backend root: where the .py services and .venv live. cwd is the backend dir
  // for both `npm run dev` (tsx) and `npm start` (node dist).
  const cwd = process.cwd();
  const scriptPath = path.join(cwd, spec.script);

  if (await isPortInUse(spec.port)) {
    console.log(`[stt-sidecar] ${spec.label} already running on :${spec.port} — reusing it`);
    return;
  }

  if (!fs.existsSync(scriptPath)) {
    console.warn(`[stt-sidecar] ${spec.script} not found at ${scriptPath}; cannot auto-start — ` +
      `transcripts will be EMPTY. Start it manually or check STT_ENGINE.`);
    return;
  }

  const python = resolvePython(cwd);
  console.log(`[stt-sidecar] starting ${spec.label} (${python} ${spec.script}) on :${spec.port}…`);

  // Inherit process.env so HF_TOKEN / AIKOSH_LANG / *_PORT etc. (already loaded
  // from .env via dotenv) reach the sidecar. PYTHONIOENCODING avoids cp1252
  // crashes when the model logs non-ASCII (e.g. Devanagari) on Windows.
  child = spawn(python, ['-u', spec.script], {
    cwd,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (d: Buffer) => process.stdout.write(`[${spec.label}] ${d}`));
  child.stderr?.on('data', (d: Buffer) => process.stderr.write(`[${spec.label}] ${d}`));

  child.on('error', (err) => {
    console.error(`[stt-sidecar] failed to spawn ${spec.label}:`, err.message);
    console.error('[stt-sidecar] transcripts will be EMPTY until the sidecar runs.');
  });

  child.on('exit', (code, signal) => {
    console.warn(`[stt-sidecar] ${spec.label} exited (code=${code} signal=${signal})`);
    child = null;
  });

  // Don't block startup on model load — the STT clients auto-reconnect every few
  // seconds, so they latch on once the model finishes loading.
  console.log(`[stt-sidecar] ${spec.label} launching in background (model load takes ~10–60s on first run)`);
}

export function stopSttSidecar(): void {
  if (child && !child.killed) {
    child.kill();
    child = null;
  }
}

// Best-effort cleanup so we don't leave an orphaned python process behind.
process.on('exit', stopSttSidecar);
process.on('SIGINT', () => { stopSttSidecar(); process.exit(0); });
process.on('SIGTERM', () => { stopSttSidecar(); process.exit(0); });
