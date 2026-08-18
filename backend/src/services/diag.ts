import fs from 'fs';
import path from 'path';

// Lightweight append-only diagnostic log so we can see what the (often elevated,
// console-invisible) backend is doing during a live meeting: bot join status,
// per-track audio levels, and transcript production. Written to backend/bot-diag.log.
const LOG = path.join(process.cwd(), 'bot-diag.log');

export function diag(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(LOG, line); } catch {}
  // Also echo to stdout for non-elevated runs.
  try { process.stdout.write('[diag] ' + line); } catch {}
}
