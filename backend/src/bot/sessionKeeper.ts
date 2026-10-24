import fs from 'fs'
import os from 'os'
import path from 'path'
import { chromium } from 'playwright'
import { config } from '../config'
import { diag } from '../services/diag'
import { fakeMediaArgs } from './fakeMedia'

// Keeps the Meet bot's Google login alive and tells someone when it isn't.
//
// Why the bot got logged out ~weekly: the login cookies themselves last >1 year,
// so expiry is server-side — Google ends web sessions that look idle/risky, and
// Workspace domains add an admin-set session length (default 14 days). A profile
// that is only opened for meetings looks idle between them. This module:
//   1. pins the bot to the profile that is actually signed in (a shared
//      user-data-dir can hold several; Chrome otherwise opens "last used", which
//      silently flips the bot to a signed-out profile),
//   2. periodically opens the real profile and visits Google so the session is
//      used and Google's rotated cookies are written back to disk,
//   3. reports the result so a sign-out is noticed before a meeting is missed.
// It cannot override a Workspace admin's session-length policy — that is an
// Admin-console setting for the bot account.

export interface ProfileChoice {
  directory: string      // Chrome --profile-directory name, e.g. "Default", "Profile 2"
  email: string | null   // account Chrome reports for that profile, if any
}

export interface SessionStatus {
  checkedAt: string
  signedIn: boolean
  account: string | null
  profile: string
  finalUrl: string
  detail: string
}

export function meetProfileBaseDir(): string {
  return config.botChromeProfileDir || path.join(os.homedir(), '.noteai', 'bot-profile')
}

/** Pick the signed-in profile from Chrome's `Local State`. Pure → unit-tested. */
export function pickSignedInProfile(localState: unknown): ProfileChoice {
  const profile = (localState as { profile?: { last_used?: string; info_cache?: Record<string, { user_name?: string }> } })?.profile ?? {}
  const cache = profile.info_cache ?? {}
  const signedIn = Object.entries(cache).filter(([, v]) => Boolean(v?.user_name))
  const preferred = signedIn.find(([name]) => name === profile.last_used) ?? signedIn[0]
  if (preferred) return { directory: preferred[0], email: preferred[1].user_name ?? null }
  // No Chrome-level account recorded: keep Chrome's own choice.
  const fallback = profile.last_used && cache[profile.last_used] ? profile.last_used : 'Default'
  return { directory: fallback, email: null }
}

export function resolveMeetProfile(baseDir = meetProfileBaseDir()): ProfileChoice {
  try {
    return pickSignedInProfile(JSON.parse(fs.readFileSync(path.join(baseDir, 'Local State'), 'utf8')))
  } catch {
    return { directory: 'Default', email: null } // fresh profile (e.g. new AWS volume)
  }
}

// Same signed-in test scripts/check-bot-sessions.ts uses for Meet.
export function isGoogleSignedInUrl(finalUrl: string): boolean {
  return finalUrl.includes('myaccount.google.com') && !/signin|ServiceLogin|\/v3\/signin/i.test(finalUrl)
}

const KEEPER_ARGS = [
  '--no-sandbox',
  '--disable-gpu',
  '--no-first-run',
  '--disable-infobars',
  '--mute-audio',
  '--disable-blink-features=AutomationControlled',
]

let lastStatus: SessionStatus | null = null
export function getMeetSessionStatus(): SessionStatus | null {
  return lastStatus
}

/**
 * Open the bot's REAL profile (so refreshed cookies persist), visit Google and
 * report whether it is still signed in. Returns null when the profile doesn't
 * exist or is busy (a bot is using it) — caller just tries again later.
 */
export async function checkAndRefreshMeetSession(): Promise<SessionStatus | null> {
  const base = meetProfileBaseDir()
  if (!fs.existsSync(path.join(base, 'Default'))) return null // no saved login at all
  const choice = resolveMeetProfile(base)

  let context
  try {
    // Plain launch on purpose: the bots' resilient launcher kills whatever holds
    // the profile lock, which could be a bot mid-meeting. If it's locked, skip.
    context = await chromium.launchPersistentContext(base, {
      channel: 'chrome',
      headless: config.botHeadless,
      args: [...KEEPER_ARGS, ...fakeMediaArgs(), `--profile-directory=${choice.directory}`],
      ignoreDefaultArgs: ['--enable-automation'],
    })
  } catch (err) {
    diag(`SESSION-KEEPER skipped — profile busy or Chrome failed: ${(err as Error).message.split('\n')[0]}`)
    return null
  }

  try {
    const page = context.pages()[0] ?? await context.newPage()
    await page.goto('https://myaccount.google.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForTimeout(4000) // let any sign-in redirect settle
    const finalUrl = page.url()
    const signedIn = isGoogleSignedInUrl(finalUrl)
    lastStatus = {
      checkedAt: new Date().toISOString(),
      signedIn,
      account: choice.email,
      profile: choice.directory,
      finalUrl,
      detail: signedIn ? 'session valid (refreshed)' : 'redirected to Google sign-in — bot is logged out',
    }
    return lastStatus
  } finally {
    await context.close().catch(() => {})
  }
}
