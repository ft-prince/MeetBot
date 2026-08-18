/**
 * Resilient persistent-context launch for the browser bots.
 *
 * Problem this solves: the bots reuse a single saved Chrome profile
 * (`~/.noteai/bot-profile`, `…/zoom-bot-profile`, `…/teams-bot-profile`). If a
 * previous bot's Chrome was orphaned — e.g. a `tsx watch` hot-reload replaced
 * the backend process while a bot was live, or a crash bypassed `stop()` — that
 * zombie Chrome keeps the profile's `lockfile` open. Every subsequent launch
 * then dies immediately with:
 *
 *   ERROR:process_singleton_win.cc  Lock file can not be created! Error code: 32
 *   Failed to create a ProcessSingleton for your profile directory.
 *
 * which surfaces to Playwright as "Target page, context or browser has been
 * closed". The profile only unlocks when the zombie is killed — but it may be
 * an ELEVATED process, so only a same-privilege caller (the backend itself) can
 * kill it.
 *
 * `launchPersistentContextResilient` catches that specific failure, kills any
 * lingering Chrome bound to THIS profile dir (never the user's own Chrome — that
 * lives under a different user-data-dir), clears stale lock files, and retries
 * once. A single healthy meeting never triggers the cleanup path.
 */
import { chromium, type BrowserContext, type LaunchOptions } from 'playwright';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { diag } from '../services/diag';

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// Files Chromium uses to enforce single-instance access to a profile. Removing
// them is safe once the holding process is gone; harmless if absent.
const LOCK_FILES = ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'lockfile'];

/**
 * Kill Chrome processes whose command line targets THIS profile directory.
 * Scoped by `--user-data-dir=<profileDir>`, so the user's personal Chrome
 * (different profile dir) is never touched. Runs with the backend's own
 * privileges, so an elevated backend can clear elevated zombie Chromes.
 */
export function killChromeForProfile(profileDir: string): void {
  try {
    if (process.platform === 'win32') {
      const script =
        `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ` +
        `Where-Object { $_.CommandLine -like '*${profileDir.replace(/'/g, "''")}*' } | ` +
        `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
      spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
        stdio: 'ignore',
        timeout: 15_000,
      });
    } else {
      // pkill matches the full arg list, so the --user-data-dir path is enough.
      spawnSync('pkill', ['-f', profileDir], { stdio: 'ignore', timeout: 10_000 });
    }
  } catch {
    /* best effort — the retry will still try to clear lock files */
  }
}

export function clearProfileLocks(profileDir: string): void {
  for (const f of LOCK_FILES) {
    try { fs.rmSync(path.join(profileDir, f), { force: true }); } catch { /* ignore */ }
  }
}

function isProfileLockError(message: string): boolean {
  return /ProcessSingleton|already in use|has been closed|Lock file can not be created/i.test(message);
}

export async function launchPersistentContextResilient(
  profileDir: string,
  options: LaunchOptions & Parameters<typeof chromium.launchPersistentContext>[1],
  label = 'bot',
): Promise<BrowserContext> {
  try {
    return await chromium.launchPersistentContext(profileDir, options);
  } catch (err) {
    const message = (err as Error).message || '';
    if (!isProfileLockError(message)) throw err;

    console.warn(`[${label}] Chrome profile "${profileDir}" is locked by a stale/zombie Chrome — cleaning up and retrying once…`);
    diag(`LAUNCH ${label}: profile lock — killing zombie chrome for ${profileDir} + clearing lock files, retrying`);

    killChromeForProfile(profileDir);
    await delay(1200);          // let the OS release the file handle
    clearProfileLocks(profileDir);
    await delay(300);

    // Let a second failure propagate — the caller surfaces it to the panel.
    return chromium.launchPersistentContext(profileDir, options);
  }
}
