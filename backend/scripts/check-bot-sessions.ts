/**
 * Headless session-health check for a saved bot Chrome profile.
 * Usage: npx tsx scripts/check-bot-sessions.ts <profileDir> <meet|zoom|teams>
 *
 * Loads the profile (should be a throwaway COPY — see check-bot-sessions.ps1, which
 * snapshots the live profile minus its lock files so this never collides with a bot
 * that is mid-meeting), navigates to an authenticated page for the platform, and
 * decides whether the saved session is still signed in.
 *
 * Output : one JSON line on stdout -> {"platform","signedIn","finalUrl","detail"}
 * Exit   : 0 = signed in, 2 = needs re-login, 1 = error (treat as unknown)
 */
import { chromium } from 'playwright'

const profileDir = process.argv[2]
const platform = (process.argv[3] || '').toLowerCase()

if (!profileDir || !['meet', 'zoom', 'teams'].includes(platform)) {
  console.log(JSON.stringify({ platform, signedIn: false, finalUrl: '', detail: 'usage: <profileDir> <meet|zoom|teams>' }))
  process.exit(1)
}

const CHROME_ARGS = [
  '--no-sandbox',
  '--disable-gpu',
  '--no-first-run',
  '--disable-infobars',
  '--disable-blink-features=AutomationControlled',
]

// Each platform: the URL to probe, and a predicate that returns true when the
// final URL/body indicate we are STILL signed in (i.e. not bounced to a login page).
const PROBES: Record<string, { url: string; signedIn: (finalUrl: string, body: string) => boolean }> = {
  meet: {
    url: 'https://myaccount.google.com/',
    // Signed in: we land on myaccount. Signed out: redirected to accounts.google.com/.../signin|ServiceLogin
    signedIn: (u) => u.includes('myaccount.google.com') && !/signin|ServiceLogin|\/v3\/signin/i.test(u),
  },
  zoom: {
    url: 'https://zoom.us/profile',
    // Signed in: stays on /profile. Signed out: redirected to /signin or shows the sign-in form.
    signedIn: (u, b) => /zoom\.us\/(profile|account)/i.test(u) && !/\/signin/i.test(u) && !/Sign In to Your Account/i.test(b),
  },
  teams: {
    url: 'https://teams.microsoft.com/',
    // Signed in: stays on a teams.* host. Signed out: redirected to login.microsoftonline.com / live login.
    signedIn: (u) => /teams\.(microsoft|live)\.com/i.test(u) && !/login\.microsoftonline\.com|login\.live\.com/i.test(u),
  },
}

async function main() {
  const probe = PROBES[platform]
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: true,
    args: CHROME_ARGS,
    ignoreDefaultArgs: ['--enable-automation'],
  })
  try {
    const page = await context.newPage()
    await page.goto(probe.url, { waitUntil: 'domcontentloaded', timeout: 25000 })
    // Give redirects a moment to settle.
    await page.waitForTimeout(4000)
    const finalUrl = page.url()
    const body = (await page.evaluate(() => document.body?.innerText || '').catch(() => '')).slice(0, 500)
    const signedIn = probe.signedIn(finalUrl, body)
    console.log(JSON.stringify({ platform, signedIn, finalUrl, detail: signedIn ? 'session valid' : 'redirected to login / not signed in' }))
    await context.close()
    process.exit(signedIn ? 0 : 2)
  } catch (err: any) {
    try { await context.close() } catch {}
    console.log(JSON.stringify({ platform, signedIn: false, finalUrl: '', detail: `error: ${err?.message || err}` }))
    process.exit(1)
  }
}

main()
